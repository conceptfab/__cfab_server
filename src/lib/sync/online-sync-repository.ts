/**
 * Online Sync Repository — reads per-user meta for dashboard display.
 *
 * Layout on disk:
 *   DATA_DIR/online-sync/<userId>/meta.json — revision, hash, timestamps
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { TableHashes } from "./contracts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const REPO_DIR = path.join(DATA_DIR, "online-sync");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSyncMeta {
  revision: number;
  payloadSha256: string;
  tableHashes: TableHashes | null;
  updatedAt: string;
  createdAt: string;
  deviceId: string | null;
}

export interface OnlineSyncUserSummary {
  userId: string;
  revision: number;
  payloadSha256: string;
  tableHashes: TableHashes | null;
  updatedAt: string;
  createdAt: string;
  deviceId: string | null;
  snapshotSizeBytes: number;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getUserMeta(userId: string): Promise<UserSyncMeta | null> {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return readJsonFile<UserSyncMeta>(path.join(REPO_DIR, safe, "meta.json"));
}

/**
 * List all users that have online-sync data, with their meta + snapshot size.
 */
export async function getAllOnlineSyncUsers(): Promise<OnlineSyncUserSummary[]> {
  try {
    const entries = await readdir(REPO_DIR, { withFileTypes: true });
    const results: OnlineSyncUserSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userId = entry.name;
      const meta = await readJsonFile<UserSyncMeta>(path.join(REPO_DIR, userId, "meta.json"));
      if (!meta) continue;

      let snapshotSizeBytes = 0;
      try {
        const s = await stat(path.join(REPO_DIR, userId, "snapshot.json.gz"));
        snapshotSizeBytes = s.size;
      } catch {}

      results.push({
        userId,
        revision: meta.revision,
        payloadSha256: meta.payloadSha256,
        tableHashes: meta.tableHashes,
        updatedAt: meta.updatedAt,
        createdAt: meta.createdAt,
        deviceId: meta.deviceId,
        snapshotSizeBytes,
      });
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
