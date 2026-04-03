/**
 * Online Sync Repository — stores per-user data snapshots with revision tracking.
 *
 * Layout on disk:
 *   DATA_DIR/online-sync/<userId>/snapshot.json   — current full archive
 *   DATA_DIR/online-sync/<userId>/meta.json       — revision, hash, timestamps
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { JsonValue, TableHashes, DeltaData } from "./contracts";
import { log } from "@/lib/observability/logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const REPO_DIR = path.join(DATA_DIR, "online-sync");

const ALLOWED_TABLES = ["sessions", "projects", "applications", "manual_sessions", "daily_files"] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

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

export interface UserSnapshot {
  version: string;
  data: Record<string, any[]>;
  tombstones?: DeltaData["tombstones"];
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function userDir(userId: string): string {
  // Sanitize userId for filesystem safety
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(REPO_DIR, safe);
}

function metaPath(userId: string): string {
  return path.join(userDir(userId), "meta.json");
}

function snapshotPath(userId: string): string {
  return path.join(userDir(userId), "snapshot.json");
}

async function ensureUserDir(userId: string): Promise<void> {
  await mkdir(userDir(userId), { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as any).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data), "utf8");
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Mutex (per-user)
// ---------------------------------------------------------------------------

const userMutexes = new Map<string, Promise<void>>();

async function withUserMutex<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const prev = userMutexes.get(userId) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => { release = resolve; });
  userMutexes.set(userId, next);
  await prev;
  try {
    return await work();
  } finally {
    release();
    // Clean up if no one is waiting
    if (userMutexes.get(userId) === next) {
      userMutexes.delete(userId);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getUserMeta(userId: string): Promise<UserSyncMeta | null> {
  return readJsonFile<UserSyncMeta>(metaPath(userId));
}

export async function getUserSnapshot(userId: string): Promise<UserSnapshot | null> {
  return readJsonFile<UserSnapshot>(snapshotPath(userId));
}

/**
 * Save a full archive (push or reseed). Returns new revision + hash.
 */
export async function saveFullSnapshot(
  userId: string,
  archive: Record<string, unknown>,
  deviceId: string | null,
  tableHashes: TableHashes | null,
): Promise<{ revision: number; payloadSha256: string }> {
  return withUserMutex(userId, async () => {
    await ensureUserDir(userId);

    const existingMeta = await readJsonFile<UserSyncMeta>(metaPath(userId));
    const serialized = JSON.stringify(archive);
    const hash = sha256(serialized);

    // No-op if hash matches
    if (existingMeta && existingMeta.payloadSha256 === hash) {
      return { revision: existingMeta.revision, payloadSha256: hash };
    }

    const newRevision = (existingMeta?.revision ?? 0) + 1;
    const now = nowIso();

    const meta: UserSyncMeta = {
      revision: newRevision,
      payloadSha256: hash,
      tableHashes,
      updatedAt: now,
      createdAt: existingMeta?.createdAt ?? now,
      deviceId,
    };

    await writeJsonFile(snapshotPath(userId), archive);
    await writeJsonFile(metaPath(userId), meta);

    log("info", "online-sync.snapshot-saved", {
      userId,
      revision: newRevision,
      hash: hash.substring(0, 12),
      sizeKB: Math.round(serialized.length / 1024),
    });

    return { revision: newRevision, payloadSha256: hash };
  });
}

/**
 * Apply a delta push on top of existing snapshot. Returns new revision + hash.
 */
export async function applyDeltaPush(
  userId: string,
  delta: DeltaData,
  baseRevision: number,
  tableHashes: TableHashes,
  deviceId: string | null,
): Promise<{
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}> {
  return withUserMutex(userId, async () => {
    await ensureUserDir(userId);

    const meta = await readJsonFile<UserSyncMeta>(metaPath(userId));

    // Base revision mismatch → reject (client must re-fetch)
    if (meta && meta.revision !== baseRevision) {
      return {
        accepted: false,
        revision: meta.revision,
        serverTableHashes: meta.tableHashes ?? tableHashes,
        reason: "revision_mismatch",
      };
    }

    // Load existing snapshot or start empty
    let snapshot = await readJsonFile<UserSnapshot>(snapshotPath(userId));
    if (!snapshot) {
      snapshot = { version: "1", data: {} };
    }

    // Apply upserts per table
    for (const tableName of ALLOWED_TABLES) {
      const rows = (delta as unknown as Record<string, any[]>)[tableName];
      if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

      if (!snapshot.data[tableName]) {
        snapshot.data[tableName] = [];
      }

      const table = snapshot.data[tableName];
      const pk = tableName === "daily_files" ? "date" : "sync_key";

      // Build index for existing rows
      const indexMap = new Map<string, number>();
      for (let i = 0; i < table.length; i++) {
        const key = table[i]?.[pk];
        if (key != null) indexMap.set(String(key), i);
      }

      for (const row of rows) {
        const key = row?.[pk];
        if (key == null) continue;
        const existing = indexMap.get(String(key));
        if (existing !== undefined) {
          table[existing] = row; // update
        } else {
          indexMap.set(String(key), table.length);
          table.push(row); // insert
        }
      }
    }

    // Apply tombstones
    if (delta.tombstones && Array.isArray(delta.tombstones)) {
      for (const ts of delta.tombstones) {
        if (!ALLOWED_TABLES.includes(ts.table_name as AllowedTable)) continue;
        const table = snapshot.data[ts.table_name];
        if (!table) continue;

        // Remove by sync_key
        const syncKey = ts.sync_key;
        if (syncKey) {
          const pk = ts.table_name === "daily_files" ? "date" : "sync_key";
          const idx = table.findIndex((r: any) => String(r?.[pk]) === String(syncKey));
          if (idx >= 0) table.splice(idx, 1);
        }
      }

      // Store tombstones
      snapshot.tombstones = [
        ...(snapshot.tombstones ?? []),
        ...delta.tombstones,
      ];
    }

    const serialized = JSON.stringify(snapshot);
    const hash = sha256(serialized);
    const newRevision = (meta?.revision ?? 0) + 1;
    const now = nowIso();

    const newMeta: UserSyncMeta = {
      revision: newRevision,
      payloadSha256: hash,
      tableHashes,
      updatedAt: now,
      createdAt: meta?.createdAt ?? now,
      deviceId,
    };

    await writeJsonFile(snapshotPath(userId), snapshot);
    await writeJsonFile(metaPath(userId), newMeta);

    log("info", "online-sync.delta-applied", {
      userId,
      revision: newRevision,
      baseRevision,
      hash: hash.substring(0, 12),
    });

    return {
      accepted: true,
      revision: newRevision,
      serverTableHashes: tableHashes,
      reason: "delta_applied",
    };
  });
}

/**
 * Check sync status: compare client revision/hash with server state.
 */
export async function checkSyncStatus(
  userId: string,
  clientRevision: number | null,
  clientHash: string | null,
  clientTableHashes?: TableHashes | null,
): Promise<{
  serverRevision: number;
  serverHash: string | null;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
  dirtyTables?: string[];
}> {
  const meta = await getUserMeta(userId);

  // No server data — client should push
  if (!meta) {
    return {
      serverRevision: 0,
      serverHash: null,
      shouldPush: true,
      shouldPull: false,
      reason: "server_has_no_snapshot",
    };
  }

  // Client has no revision — needs to pull
  if (clientRevision == null || clientRevision === 0) {
    return {
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      shouldPush: false,
      shouldPull: true,
      reason: "client_has_no_revision",
    };
  }

  // Same revision — check hash
  if (clientRevision === meta.revision) {
    if (clientHash && clientHash === meta.payloadSha256) {
      return {
        serverRevision: meta.revision,
        serverHash: meta.payloadSha256,
        shouldPush: false,
        shouldPull: false,
        reason: "same_hash",
      };
    }

    if (!clientHash) {
      return {
        serverRevision: meta.revision,
        serverHash: meta.payloadSha256,
        shouldPush: false,
        shouldPull: false,
        reason: "same_revision_hash_not_provided",
      };
    }

    // Same revision but different hash — client has changes to push
    // Check table hashes for dirty tables
    let dirtyTables: string[] | undefined;
    if (clientTableHashes && meta.tableHashes) {
      dirtyTables = [];
      for (const t of ALLOWED_TABLES) {
        if ((clientTableHashes as any)[t] !== (meta.tableHashes as any)[t]) {
          dirtyTables.push(t);
        }
      }
    }

    return {
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      shouldPush: true,
      shouldPull: false,
      reason: "hash_mismatch",
      dirtyTables,
    };
  }

  // Client is behind — needs to pull
  if (clientRevision < meta.revision) {
    return {
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      shouldPush: false,
      shouldPull: true,
      reason: "client_behind",
    };
  }

  // Client is ahead — unusual, treat as push needed
  return {
    serverRevision: meta.revision,
    serverHash: meta.payloadSha256,
    shouldPush: true,
    shouldPull: false,
    reason: "client_ahead",
  };
}

/**
 * Get snapshot for pull (full archive).
 */
export async function getSnapshotForPull(
  userId: string,
  clientRevision: number | null,
): Promise<{
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  archive?: Record<string, unknown>;
  reason: string;
}> {
  const meta = await getUserMeta(userId);

  if (!meta) {
    return {
      hasUpdate: false,
      revision: null,
      payloadSha256: null,
      reason: "server_has_no_snapshot",
    };
  }

  // Client is up to date
  if (clientRevision != null && clientRevision >= meta.revision) {
    return {
      hasUpdate: false,
      revision: meta.revision,
      payloadSha256: meta.payloadSha256,
      reason: "client_up_to_date",
    };
  }

  // Client needs the full snapshot
  const snapshot = await getUserSnapshot(userId);
  if (!snapshot) {
    return {
      hasUpdate: false,
      revision: meta.revision,
      payloadSha256: meta.payloadSha256,
      reason: "server_snapshot_pruned",
    };
  }

  return {
    hasUpdate: true,
    revision: meta.revision,
    payloadSha256: meta.payloadSha256,
    archive: snapshot as unknown as Record<string, unknown>,
    reason: "update_available",
  };
}

/**
 * Acknowledge a pull — verify the client received the correct data.
 */
export async function acknowledgePull(
  userId: string,
  revision: number,
  payloadSha256: string,
): Promise<{
  accepted: boolean;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}> {
  const meta = await getUserMeta(userId);

  if (!meta) {
    return {
      accepted: false,
      serverRevision: 0,
      serverHash: null,
      isLatest: false,
      reason: "no_server_data",
    };
  }

  if (revision === meta.revision && payloadSha256 === meta.payloadSha256) {
    return {
      accepted: true,
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      isLatest: true,
      reason: "ack_accepted",
    };
  }

  // Revision matches but hash doesn't — might be an older ack
  if (revision <= meta.revision) {
    return {
      accepted: true,
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      isLatest: revision === meta.revision,
      reason: "ack_accepted_stale",
    };
  }

  return {
    accepted: false,
    serverRevision: meta.revision,
    serverHash: meta.payloadSha256,
    isLatest: false,
    reason: "unknown_revision",
  };
}

/**
 * List all users that have online-sync data, with their meta + snapshot size.
 */
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
        const s = await stat(path.join(REPO_DIR, userId, "snapshot.json"));
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
    if (typeof error === "object" && error !== null && "code" in error && (error as any).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
