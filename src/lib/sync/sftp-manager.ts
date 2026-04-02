import SftpClient from "ssh2-sftp-client";
import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";
import type {
  StorageBackendConfig,
  SftpStorageBackend,
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
}

export interface StorageFullTestResult {
  uploadOk: boolean;
  downloadOk: boolean;
  matchOk: boolean;
  latencyMs: number;
  error: string | null;
}

export interface StorageConnectionInfo {
  protocol: "sftp" | "s3";
  host: string;
  port: number;
  username: string;
  password: string;
  basePath: string;
  uploadPath: string;
  downloadPath: string;
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
      await withSftp(async (sftp) => {
        await sftp.mkdir(`${sessionPath}/slave-upload`, true);
        await sftp.mkdir(`${sessionPath}/master-merged`, true);
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
  };
}

// --- S3 adapter (placeholder for future implementation) ---

function createS3Adapter(_config: S3StorageBackend): StorageAdapter {
  return {
    async createSessionDir(_sessionId: string): Promise<string> {
      throw new Error("S3 storage backend is not yet implemented");
    },
    async deleteSessionDir(_sessionId: string): Promise<void> {
      throw new Error("S3 storage backend is not yet implemented");
    },
    async healthCheck(): Promise<void> {
      throw new Error("S3 storage backend is not yet implemented");
    },
    async fullTest(): Promise<StorageFullTestResult> {
      throw new Error("S3 storage backend is not yet implemented");
    },
    async listSessionDirs(): Promise<string[]> {
      throw new Error("S3 storage backend is not yet implemented");
    },
    getConnectionInfo(_sessionId: string): StorageConnectionInfo {
      throw new Error("S3 storage backend is not yet implemented");
    },
  };
}

// --- Factory ---

export function createStorageAdapter(config: StorageBackendConfig): StorageAdapter {
  switch (config.type) {
    case "sftp":
      return createSftpAdapter(config);
    case "aws-s3":
      return createS3Adapter(config);
    default:
      throw new Error(`Unknown storage backend type: ${(config as any).type}`);
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
