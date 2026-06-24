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

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionCleanupResult {
  expired: number;
  removed: number;
  asyncExpired: number;
  asyncRemoved: number;
}

/**
 * Run one cleanup pass: expire timed-out sessions, delete their storage dirs,
 * prune old terminal sessions, sweep orphaned SFTP dirs, and expire/prune async
 * delta packages. Idempotent and awaitable — invoked by the Vercel Cron route
 * (no in-process timer, so it works on serverless).
 */
export async function runSessionCleanup(): Promise<SessionCleanupResult> {
  // 1. Mark timed-out sessions as expired
  const expired = await expireSessions();

  // 2. Get terminal sessions (with storagePath) BEFORE removing them
  const completedIds = await getCompletedSessionIds();

  // 3. Delete storage dirs for those sessions first
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

  // 4. Now safe to remove sessions
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
  for (const { id } of cleanableAsync) {
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

  return { expired, removed, asyncExpired, asyncRemoved };
}
