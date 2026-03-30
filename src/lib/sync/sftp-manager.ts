import SftpClient from "ssh2-sftp-client";
import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";

// --- Types ---

export interface SftpHealthStatus {
  available: boolean;
  lastCheckAt: string;
  activeSessions: number;
  orphanedDirs: number;
  error: string | null;
}

// --- Connection helper ---

async function withSftp<T>(fn: (sftp: SftpClient) => Promise<T>): Promise<T> {
  const env = getEnv();
  if (!env.sftpHost || !env.sftpUser || !env.sftpPassword) {
    throw new Error(
      "SFTP not configured: missing SFTP_HOST, SFTP_USER, or SFTP_PASSWORD",
    );
  }
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: env.sftpHost,
      port: env.sftpPort,
      username: env.sftpUser,
      password: env.sftpPassword,
    });
    return await fn(sftp);
  } finally {
    await sftp.end();
  }
}

// --- Directory operations ---

export async function createSessionDir(sessionId: string): Promise<string> {
  const env = getEnv();
  const sessionPath = `${env.sftpBasePath}${sessionId}`;

  await withSftp(async (sftp) => {
    await sftp.mkdir(`${sessionPath}/slave-upload`, true);
    await sftp.mkdir(`${sessionPath}/master-merged`, true);
  });

  log("info", "sftp.session-dir.created", { sessionId, path: sessionPath });
  return sessionPath;
}

export async function deleteSessionDir(sessionId: string): Promise<void> {
  const env = getEnv();
  const sessionPath = `${env.sftpBasePath}${sessionId}`;

  try {
    await withSftp(async (sftp) => {
      const exists = await sftp.exists(sessionPath);
      if (exists) {
        await sftp.rmdir(sessionPath, true);
      }
    });
    log("info", "sftp.session-dir.deleted", { sessionId });
  } catch (error) {
    log("error", "sftp.session-dir.delete-failed", {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function healthCheck(): Promise<SftpHealthStatus> {
  const now = new Date().toISOString();
  const env = getEnv();

  if (!env.sftpHost || !env.sftpUser || !env.sftpPassword) {
    return {
      available: false,
      lastCheckAt: now,
      activeSessions: 0,
      orphanedDirs: 0,
      error: "SFTP not configured",
    };
  }

  try {
    return await withSftp(async (sftp) => {
      const basePath = env.sftpBasePath;
      let dirs: string[] = [];
      const exists = await sftp.exists(basePath);
      if (exists) {
        const list = await sftp.list(basePath);
        dirs = list
          .filter((item) => item.type === "d")
          .map((item) => item.name);
      }

      return {
        available: true,
        lastCheckAt: now,
        activeSessions: dirs.length,
        orphanedDirs: 0, // Will be calculated by caller with session store context
        error: null,
      };
    });
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
  const env = getEnv();

  return withSftp(async (sftp) => {
    const basePath = env.sftpBasePath;
    const exists = await sftp.exists(basePath);
    if (!exists) return [];
    const list = await sftp.list(basePath);
    return list.filter((item) => item.type === "d").map((item) => item.name);
  });
}
