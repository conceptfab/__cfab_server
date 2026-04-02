import {
  expireSessions,
  cleanupOldSessions,
  getCompletedSessionIds,
  getActiveSessionIds,
  expireAsyncPackages,
  cleanupOldAsyncPackages,
  getCleanableAsyncPackageIds,
} from "./session-store";
import { deleteSessionDir, listSessionDirs } from "./sftp-manager";
import { log } from "@/lib/observability/logger";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startSessionCleanup(): void {
  if (cleanupInterval) return;
  runCleanup();
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  log("info", "session-cleanup.started", { intervalMs: CLEANUP_INTERVAL_MS });
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log("info", "session-cleanup.stopped", {});
  }
}

function runCleanup(): void {
  void (async () => {
    try {
      // 1. Mark timed-out sessions as expired
      const expired = await expireSessions();

      // 2. Get terminal sessions (with storagePath) BEFORE removing from JSON
      const completedIds = await getCompletedSessionIds();

      // 3. Delete SFTP dirs for those sessions first
      for (const id of completedIds) {
        try {
          await deleteSessionDir(id);
        } catch (err) {
          log("error", "session-cleanup.delete-failed", {
            sessionId: id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 4. Now safe to remove sessions from JSON store
      const removed = await cleanupOldSessions(MAX_SESSION_AGE_MS);

      // 5. Orphan detection (safety net): SFTP dirs without active sessions
      try {
        const sftpDirs = await listSessionDirs();
        const activeIds = await getActiveSessionIds();
        const activeSet = new Set(activeIds);
        for (const dir of sftpDirs) {
          if (!activeSet.has(dir)) {
            try {
              await deleteSessionDir(dir);
            } catch (err) {
              log("error", "session-cleanup.orphan-delete-failed", {
                dir,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch {
        // SFTP may not be configured — ignore
      }

      // 6. Expire and cleanup async delta packages
      const asyncExpired = await expireAsyncPackages();
      const cleanableAsync = await getCleanableAsyncPackageIds();
      for (const { id, storagePath } of cleanableAsync) {
        try {
          await deleteSessionDir(`async/${id}`);
        } catch (err) {
          log("error", "session-cleanup.async-delete-failed", {
            packageId: id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const asyncRemoved = await cleanupOldAsyncPackages(MAX_SESSION_AGE_MS);

      if (expired > 0 || removed > 0 || asyncExpired > 0 || asyncRemoved > 0) {
        log("info", "session-cleanup.completed", { expired, removed, asyncExpired, asyncRemoved });
      }
    } catch (error) {
      log("error", "session-cleanup.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

export function ensureCleanupRunning(): void {
  if (!initialized) {
    initialized = true;
    startSessionCleanup();
  }
}
