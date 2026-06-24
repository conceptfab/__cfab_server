import SftpClient from "ssh2-sftp-client";
import * as ftp from "basic-ftp";
import { Readable, Writable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";
import type {
  StorageBackendConfig,
  SftpStorageBackend,
  FtpStorageBackend,
  S3StorageBackend,
} from "@/lib/sync/license-contracts";

// --- Types ---

export interface SftpHealthStatus {
  available: boolean;
  lastCheckAt: string;
  activeSessions: number;
  orphanedDirs: number;
  error: string | null;
}

// --- Storage adapter interface ---

export interface StorageAdapter {
  createSessionDir(sessionId: string): Promise<string>;
  deleteSessionDir(sessionId: string): Promise<void>;
  healthCheck(): Promise<void>;
  fullTest(): Promise<StorageFullTestResult>;
  listSessionDirs(): Promise<string[]>;
  getConnectionInfo(sessionId: string): StorageConnectionInfo;
  uploadFile(remotePath: string, content: Buffer): Promise<void>;
  downloadFile(remotePath: string): Promise<Buffer | null>;
}

export interface StorageFullTestResult {
  uploadOk: boolean;
  downloadOk: boolean;
  matchOk: boolean;
  latencyMs: number;
  error: string | null;
}

export interface StorageConnectionInfo {
  protocol: "sftp" | "ftp" | "s3";
  host: string;
  port: number;
  username: string;
  password: string;
  basePath: string;
  uploadPath: string;
  downloadPath: string;
  /** FTP: czy używać explicit FTPS (AUTH TLS). Inne protokoły: undefined. */
  secure?: boolean;
}

// --- SFTP adapter ---

function createSftpAdapter(config: SftpStorageBackend): StorageAdapter {
  async function withSftp<T>(fn: (sftp: SftpClient) => Promise<T>): Promise<T> {
    const sftp = new SftpClient();
    try {
      await sftp.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
      });
      return await fn(sftp);
    } finally {
      await sftp.end();
    }
  }

  return {
    async createSessionDir(sessionId: string): Promise<string> {
      const sessionPath = `${config.basePath}${sessionId}`;
      const isAsync = sessionId.startsWith("async/");
      await withSftp(async (sftp) => {
        await sftp.mkdir(`${sessionPath}/slave-upload`, true);
        // master-merged is unused in the async store-and-forward model (F5): skip for async packages.
        // Keep for legacy LAN/session sync dirs in case the client demon still reads downloadPath.
        if (!isAsync) {
          await sftp.mkdir(`${sessionPath}/master-merged`, true);
        }
      });
      log("info", "sftp.session-dir.created", { sessionId, path: sessionPath, backendId: config.id });
      return sessionPath;
    },

    async deleteSessionDir(sessionId: string): Promise<void> {
      const sessionPath = `${config.basePath}${sessionId}`;
      try {
        await withSftp(async (sftp) => {
          const exists = await sftp.exists(sessionPath);
          if (exists) {
            await sftp.rmdir(sessionPath, true);
          }
        });
        log("info", "sftp.session-dir.deleted", { sessionId, backendId: config.id });
      } catch (error) {
        log("error", "sftp.session-dir.delete-failed", {
          sessionId,
          backendId: config.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async healthCheck(): Promise<void> {
      await withSftp(async (sftp) => {
        const testDir = `${config.basePath}_health_check_${Date.now()}`;
        await sftp.mkdir(testDir, true);
        await sftp.rmdir(testDir);
      });
    },

    async fullTest(): Promise<{ uploadOk: boolean; downloadOk: boolean; matchOk: boolean; latencyMs: number; error: string | null }> {
      const start = Date.now();
      const testPayload = Buffer.from(`cfab-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const testDir = `${config.basePath}_fulltest_${Date.now()}`;
      const testFile = `${testDir}/test.bin`;

      try {
        const result = await withSftp(async (sftp) => {
          // 1. Create dir
          await sftp.mkdir(testDir, true);

          // 2. Upload
          await sftp.put(testPayload, testFile);
          const uploadOk = true;

          // 3. Download
          const downloaded = await sftp.get(testFile) as Buffer;
          const downloadOk = true;

          // 4. Compare
          const matchOk = Buffer.isBuffer(downloaded) && downloaded.equals(testPayload);

          // 5. Cleanup
          await sftp.delete(testFile);
          await sftp.rmdir(testDir);

          return { uploadOk, downloadOk, matchOk, latencyMs: Date.now() - start, error: null };
        });
        return result;
      } catch (error) {
        // Try cleanup
        try {
          await withSftp(async (sftp) => {
            const exists = await sftp.exists(testDir);
            if (exists) await sftp.rmdir(testDir, true);
          });
        } catch { /* ignore cleanup errors */ }

        return {
          uploadOk: false,
          downloadOk: false,
          matchOk: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSessionDirs(): Promise<string[]> {
      return withSftp(async (sftp) => {
        const exists = await sftp.exists(config.basePath);
        if (!exists) return [];
        const list = await sftp.list(config.basePath);
        return list.filter((item) => item.type === "d").map((item) => item.name);
      });
    },

    getConnectionInfo(sessionId: string): StorageConnectionInfo {
      const sessionPath = `${config.basePath}${sessionId}`;
      return {
        protocol: "sftp",
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        basePath: config.basePath,
        uploadPath: `${sessionPath}/slave-upload/`,
        downloadPath: `${sessionPath}/master-merged/`,
      };
    },

    async uploadFile(remotePath: string, content: Buffer): Promise<void> {
      await withSftp(async (sftp) => {
        // Ensure parent directory exists
        const dir = remotePath.substring(0, remotePath.lastIndexOf("/"));
        if (dir) await sftp.mkdir(dir, true);
        await sftp.put(content, remotePath);
      });
    },

    async downloadFile(remotePath: string): Promise<Buffer | null> {
      try {
        return await withSftp(async (sftp) => {
          const result = await sftp.get(remotePath);
          return Buffer.isBuffer(result) ? result : Buffer.from(result as string);
        });
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 2) {
          return null; // file not found
        }
        throw error;
      }
    },
  };
}

// --- S3 adapter ---

function createS3Adapter(config: S3StorageBackend): StorageAdapter {
  const s3 = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  // S3 doesn't have real directories — we use key prefixes.
  // basePath from StorageBackendBase (e.g. "sync/") is the prefix root.
  const prefix = (config as { basePath?: string }).basePath?.replace(/\/$/, "") ?? "sync";

  function sessionPrefix(sessionId: string): string {
    return `${prefix}/${sessionId}/`;
  }

  return {
    async createSessionDir(sessionId: string): Promise<string> {
      // S3 doesn't need directory creation, but we put a marker so listSessionDirs works
      const markerKey = `${sessionPrefix(sessionId)}.cfab-session`;
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: markerKey,
        Body: Buffer.from(new Date().toISOString()),
      }));
      log("info", "s3.session-dir.created", { sessionId, bucket: config.bucket, prefix: sessionPrefix(sessionId), backendId: config.id });
      return sessionPrefix(sessionId);
    },

    async deleteSessionDir(sessionId: string): Promise<void> {
      try {
        // List all objects under session prefix and delete them
        const pfx = sessionPrefix(sessionId);
        let continuationToken: string | undefined;
        const keysToDelete: { Key: string }[] = [];

        do {
          const listResp = await s3.send(new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: pfx,
            ContinuationToken: continuationToken,
          }));
          for (const obj of listResp.Contents ?? []) {
            if (obj.Key) keysToDelete.push({ Key: obj.Key });
          }
          continuationToken = listResp.NextContinuationToken;
        } while (continuationToken);

        if (keysToDelete.length > 0) {
          // DeleteObjects supports up to 1000 keys at once
          for (let i = 0; i < keysToDelete.length; i += 1000) {
            await s3.send(new DeleteObjectsCommand({
              Bucket: config.bucket,
              Delete: { Objects: keysToDelete.slice(i, i + 1000) },
            }));
          }
        }
        log("info", "s3.session-dir.deleted", { sessionId, deletedKeys: keysToDelete.length, backendId: config.id });
      } catch (error) {
        log("error", "s3.session-dir.delete-failed", {
          sessionId,
          backendId: config.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async healthCheck(): Promise<void> {
      await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
    },

    async fullTest(): Promise<StorageFullTestResult> {
      const start = Date.now();
      const testPayload = Buffer.from(`cfab-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const testKey = `${prefix}/_fulltest_${Date.now()}/test.bin`;

      try {
        // Upload
        await s3.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
          Body: testPayload,
        }));

        // Download
        const getResp = await s3.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
        }));
        const downloaded = Buffer.from(await getResp.Body!.transformToByteArray());
        const matchOk = downloaded.equals(testPayload);

        // Cleanup
        await s3.send(new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: [{ Key: testKey }] },
        }));

        return { uploadOk: true, downloadOk: true, matchOk, latencyMs: Date.now() - start, error: null };
      } catch (error) {
        // Try cleanup
        try {
          await s3.send(new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: [{ Key: testKey }] },
          }));
        } catch { /* ignore */ }

        return {
          uploadOk: false,
          downloadOk: false,
          matchOk: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSessionDirs(): Promise<string[]> {
      const pfx = `${prefix}/`;
      const listResp = await s3.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: pfx,
        Delimiter: "/",
      }));
      return (listResp.CommonPrefixes ?? [])
        .map((cp) => cp.Prefix ?? "")
        .filter((p) => p.length > pfx.length)
        .map((p) => p.slice(pfx.length).replace(/\/$/, ""));
    },

    getConnectionInfo(sessionId: string): StorageConnectionInfo {
      const sp = sessionPrefix(sessionId);
      return {
        protocol: "s3",
        host: `${config.bucket}.s3.${config.region}.amazonaws.com`,
        port: 443,
        username: config.accessKeyId,
        password: config.secretAccessKey,
        basePath: prefix,
        uploadPath: `${sp}slave-upload/`,
        downloadPath: `${sp}master-merged/`,
      };
    },

    async uploadFile(remotePath: string, content: Buffer): Promise<void> {
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: remotePath,
        Body: content,
      }));
    },

    async downloadFile(remotePath: string): Promise<Buffer | null> {
      try {
        const resp = await s3.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: remotePath,
        }));
        return Buffer.from(await resp.Body!.transformToByteArray());
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "NoSuchKey") {
          return null;
        }
        throw error;
      }
    },
  };
}

// --- FTP adapter (plain FTP using basic-ftp) ---

function createFtpAdapter(config: FtpStorageBackend): StorageAdapter {
  async function withFtp<T>(fn: (client: ftp.Client) => Promise<T>): Promise<T> {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password,
        secure: config.secure,
      });
      return await fn(client);
    } finally {
      client.close();
    }
  }

  return {
    async createSessionDir(sessionId: string): Promise<string> {
      const sessionPath = `${config.basePath}${sessionId}`;
      const isAsync = sessionId.startsWith("async/");
      await withFtp(async (client) => {
        await client.ensureDir(`${sessionPath}/slave-upload`);
        // master-merged is unused in the async store-and-forward model (F5): skip for async packages.
        // Keep for legacy LAN/session sync dirs in case the client demon still reads downloadPath.
        if (!isAsync) {
          await client.ensureDir(`${sessionPath}/master-merged`);
        }
      });
      log("info", "ftp.session-dir.created", { sessionId, path: sessionPath, backendId: config.id });
      return sessionPath;
    },

    async deleteSessionDir(sessionId: string): Promise<void> {
      const sessionPath = `${config.basePath}${sessionId}`;
      try {
        await withFtp(async (client) => {
          await client.removeDir(sessionPath);
        });
        log("info", "ftp.session-dir.deleted", { sessionId, backendId: config.id });
      } catch (error) {
        log("error", "ftp.session-dir.delete-failed", {
          sessionId,
          backendId: config.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async healthCheck(): Promise<void> {
      await withFtp(async (client) => {
        const testDir = `${config.basePath}_health_check_${Date.now()}`;
        await client.ensureDir(testDir);
        await client.removeDir(testDir);
      });
    },

    async fullTest(): Promise<StorageFullTestResult> {
      const start = Date.now();
      const testPayload = Buffer.from(`cfab-ftp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const testDir = `${config.basePath}_fulltest_${Date.now()}`;
      const testFile = `${testDir}/test.bin`;

      try {
        const result = await withFtp(async (client) => {
          // 1. Create dir
          await client.ensureDir(testDir);

          // 2. Upload
          const uploadStream = Readable.from(testPayload);
          await client.uploadFrom(uploadStream, testFile);
          const uploadOk = true;

          // 3. Download
          const chunks: Buffer[] = [];
          const downloadStream = new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              callback();
            },
          });
          await client.downloadTo(downloadStream, testFile);
          const downloaded = Buffer.concat(chunks);
          const downloadOk = true;

          // 4. Compare
          const matchOk = downloaded.equals(testPayload);

          // 5. Cleanup
          await client.remove(testFile);
          await client.removeDir(testDir);

          return { uploadOk, downloadOk, matchOk, latencyMs: Date.now() - start, error: null };
        });
        return result;
      } catch (error) {
        try {
          await withFtp(async (client) => {
            await client.removeDir(testDir);
          });
        } catch { /* ignore cleanup errors */ }

        return {
          uploadOk: false,
          downloadOk: false,
          matchOk: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSessionDirs(): Promise<string[]> {
      return withFtp(async (client) => {
        try {
          const list = await client.list(config.basePath);
          return list.filter((item) => item.isDirectory).map((item) => item.name);
        } catch {
          return [];
        }
      });
    },

    getConnectionInfo(sessionId: string): StorageConnectionInfo {
      const sessionPath = `${config.basePath}${sessionId}`;
      return {
        protocol: "ftp",
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        basePath: config.basePath,
        uploadPath: `${sessionPath}/slave-upload/`,
        downloadPath: `${sessionPath}/master-merged/`,
        secure: config.secure,
      };
    },

    async uploadFile(remotePath: string, content: Buffer): Promise<void> {
      await withFtp(async (client) => {
        const dir = remotePath.substring(0, remotePath.lastIndexOf("/"));
        if (dir) await client.ensureDir(dir);
        const stream = Readable.from(content);
        await client.uploadFrom(stream, remotePath);
      });
    },

    async downloadFile(remotePath: string): Promise<Buffer | null> {
      try {
        return await withFtp(async (client) => {
          const chunks: Buffer[] = [];
          const ws = new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              callback();
            },
          });
          await client.downloadTo(ws, remotePath);
          return Buffer.concat(chunks);
        });
      } catch {
        return null;
      }
    },
  };
}

// --- Factory ---

export function createStorageAdapter(config: StorageBackendConfig): StorageAdapter {
  switch (config.type) {
    case "sftp":
      return createSftpAdapter(config);
    case "ftp":
      return createFtpAdapter(config);
    case "aws-s3":
      return createS3Adapter(config);
    default:
      throw new Error(`Unknown storage backend type: ${(config as { type?: string }).type}`);
  }
}

// --- Global SFTP fallback (uses env vars) ---

function getGlobalSftpConfig(): SftpStorageBackend | null {
  const env = getEnv();
  if (!env.sftpHost || !env.sftpUser || !env.sftpPassword) return null;
  return {
    id: "global",
    type: "sftp",
    name: "Global SFTP (env)",
    basePath: env.sftpBasePath,
    maxFileSizeMb: env.sftpMaxFileSizeMb,
    sessionTtlMinutes: 60,
    createdAt: "",
    host: env.sftpHost,
    port: env.sftpPort,
    username: env.sftpUser,
    password: env.sftpPassword,
  };
}

export function getGlobalStorageAdapter(): StorageAdapter | null {
  const config = getGlobalSftpConfig();
  if (!config) return null;
  return createSftpAdapter(config);
}

// --- Legacy functions (delegate to global adapter) ---

export async function createSessionDir(sessionId: string): Promise<string> {
  const adapter = getGlobalStorageAdapter();
  if (!adapter) throw new Error("SFTP not configured: missing SFTP_HOST, SFTP_USER, or SFTP_PASSWORD");
  return adapter.createSessionDir(sessionId);
}

export async function deleteSessionDir(sessionId: string): Promise<void> {
  const adapter = getGlobalStorageAdapter();
  if (!adapter) return;
  return adapter.deleteSessionDir(sessionId);
}

export async function healthCheck(): Promise<SftpHealthStatus> {
  const now = new Date().toISOString();
  const adapter = getGlobalStorageAdapter();

  if (!adapter) {
    return {
      available: false,
      lastCheckAt: now,
      activeSessions: 0,
      orphanedDirs: 0,
      error: "SFTP not configured",
    };
  }

  try {
    const dirs = await adapter.listSessionDirs();
    return {
      available: true,
      lastCheckAt: now,
      activeSessions: dirs.length,
      orphanedDirs: 0,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      lastCheckAt: now,
      activeSessions: 0,
      orphanedDirs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listSessionDirs(): Promise<string[]> {
  const adapter = getGlobalStorageAdapter();
  if (!adapter) return [];
  return adapter.listSessionDirs();
}
