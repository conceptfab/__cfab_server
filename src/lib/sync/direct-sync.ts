/**
 * Direct Sync — simple revision-based sync for desktop Tauri clients.
 *
 * Storage layout (per user):
 *   DATA_DIR/online-sync/<userId>/meta.json     — revision, hash, timestamps
 *   DATA_DIR/online-sync/<userId>/snapshot.json  — full data archive
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type { TableHashes, DeltaData } from "./contracts";
import { log } from "@/lib/observability/logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const REPO_DIR = path.join(DATA_DIR, "online-sync");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserMeta {
  revision: number;
  payloadSha256: string;
  tableHashes: TableHashes | null;
  updatedAt: string;
  createdAt: string;
  deviceId: string | null;
}

interface SnapshotArchive {
  version?: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

// -- Request / Response types -----------------------------------------------

export interface StatusBody {
  userId: string;
  deviceId: string;
  clientRevision: number;
  clientHash: string | null;
  tableHashes?: TableHashes;
}

export interface StatusResponse {
  ok: true;
  serverRevision: number;
  serverHash: string | null;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
}

export interface PushBody {
  userId: string;
  deviceId: string;
  knownServerRevision: number | null;
  archive: SnapshotArchive;
}

export interface PushResponse {
  ok: true;
  accepted: boolean;
  noOp: boolean;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  reason: string;
}

export interface DeltaPullBody {
  userId: string;
  deviceId: string;
  clientRevision: number;
}

export interface DeltaPullResponse {
  ok: true;
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: SnapshotArchive;
  reason: string;
}

export interface DeltaPushBody {
  userId: string;
  deviceId: string;
  tableHashes: TableHashes;
  baseRevision: number;
  delta: DeltaData;
}

export interface DeltaPushResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}

export interface AckBody {
  userId: string;
  deviceId: string;
  revision: number;
  payloadSha256: string;
}

export interface AckResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  payloadSha256: string;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(REPO_DIR, safe);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data), "utf8");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleStatus(
  userId: string,
  body: StatusBody,
): Promise<StatusResponse> {
  const dir = userDir(userId);
  const meta = await readJson<UserMeta>(path.join(dir, "meta.json"));

  if (!meta) {
    // No data on server — client should push
    return {
      ok: true,
      serverRevision: 0,
      serverHash: null,
      shouldPush: true,
      shouldPull: false,
      reason: "no_server_data",
    };
  }

  const revisionMatch = body.clientRevision === meta.revision;
  const hashMatch =
    body.clientHash != null &&
    meta.payloadSha256 != null &&
    body.clientHash === meta.payloadSha256;

  if (revisionMatch && hashMatch) {
    return {
      ok: true,
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      shouldPush: false,
      shouldPull: false,
      reason: "in_sync",
    };
  }

  // Table-hash based comparison for delta detection
  if (body.tableHashes && meta.tableHashes) {
    const tablesMatch =
      body.tableHashes.projects === meta.tableHashes.projects &&
      body.tableHashes.applications === meta.tableHashes.applications &&
      body.tableHashes.sessions === meta.tableHashes.sessions &&
      body.tableHashes.manual_sessions === meta.tableHashes.manual_sessions;

    if (tablesMatch) {
      return {
        ok: true,
        serverRevision: meta.revision,
        serverHash: meta.payloadSha256,
        shouldPush: false,
        shouldPull: false,
        reason: "table_hashes_match",
      };
    }
  }

  if (body.clientRevision < meta.revision) {
    return {
      ok: true,
      serverRevision: meta.revision,
      serverHash: meta.payloadSha256,
      shouldPush: false,
      shouldPull: true,
      reason: "client_behind",
    };
  }

  // Client ahead or hash mismatch — push
  return {
    ok: true,
    serverRevision: meta.revision,
    serverHash: meta.payloadSha256,
    shouldPush: true,
    shouldPull: false,
    reason:
      body.clientRevision > meta.revision
        ? "client_ahead"
        : "hash_mismatch",
  };
}

export async function handlePush(
  userId: string,
  body: PushBody,
): Promise<PushResponse> {
  const dir = userDir(userId);
  await ensureDir(dir);

  const archiveStr = JSON.stringify(body.archive);
  const hash = sha256(archiveStr);
  const now = new Date().toISOString();

  const existingMeta = await readJson<UserMeta>(path.join(dir, "meta.json"));
  const currentRevision = existingMeta?.revision ?? 0;

  // If archive identical, no-op
  if (existingMeta && existingMeta.payloadSha256 === hash) {
    return {
      ok: true,
      accepted: true,
      noOp: true,
      revision: currentRevision,
      payloadSha256: hash,
      receivedAt: now,
      reason: "no_change",
    };
  }

  const newRevision = currentRevision + 1;

  await writeJson(path.join(dir, "snapshot.json"), body.archive);

  const meta: UserMeta = {
    revision: newRevision,
    payloadSha256: hash,
    tableHashes: null,
    updatedAt: now,
    createdAt: existingMeta?.createdAt ?? now,
    deviceId: body.deviceId,
  };
  await writeJson(path.join(dir, "meta.json"), meta);

  log("info", "direct-sync.push", {
    userId,
    deviceId: body.deviceId,
    revision: newRevision,
    hash: hash.substring(0, 12),
    sizeBytes: archiveStr.length,
  });

  return {
    ok: true,
    accepted: true,
    noOp: false,
    revision: newRevision,
    payloadSha256: hash,
    receivedAt: now,
    reason: "accepted",
  };
}

export async function handleDeltaPull(
  userId: string,
  body: DeltaPullBody,
): Promise<DeltaPullResponse> {
  const dir = userDir(userId);
  const meta = await readJson<UserMeta>(path.join(dir, "meta.json"));

  if (!meta) {
    return {
      ok: true,
      hasUpdate: false,
      revision: null,
      payloadSha256: null,
      receivedAt: null,
      reason: "no_server_data",
    };
  }

  if (body.clientRevision >= meta.revision) {
    return {
      ok: true,
      hasUpdate: false,
      revision: meta.revision,
      payloadSha256: meta.payloadSha256,
      receivedAt: meta.updatedAt,
      reason: "already_up_to_date",
    };
  }

  const snapshot = await readJson<SnapshotArchive>(
    path.join(dir, "snapshot.json"),
  );

  if (!snapshot) {
    return {
      ok: true,
      hasUpdate: false,
      revision: meta.revision,
      payloadSha256: meta.payloadSha256,
      receivedAt: meta.updatedAt,
      reason: "server_snapshot_pruned",
    };
  }

  log("info", "direct-sync.delta-pull", {
    userId,
    deviceId: body.deviceId,
    clientRevision: body.clientRevision,
    serverRevision: meta.revision,
  });

  return {
    ok: true,
    hasUpdate: true,
    revision: meta.revision,
    payloadSha256: meta.payloadSha256,
    receivedAt: meta.updatedAt,
    archive: snapshot,
    reason: "update_available",
  };
}

export async function handleDeltaPush(
  userId: string,
  body: DeltaPushBody,
): Promise<DeltaPushResponse> {
  const dir = userDir(userId);
  await ensureDir(dir);

  const meta = await readJson<UserMeta>(path.join(dir, "meta.json"));
  const currentRevision = meta?.revision ?? 0;

  // Load existing snapshot or start fresh
  let snapshot =
    (await readJson<SnapshotArchive>(path.join(dir, "snapshot.json"))) ?? {
      version: "1",
      data: {
        projects: [],
        applications: [],
        sessions: [],
        manual_sessions: [],
      },
    };

  // Merge delta data into snapshot
  const data = snapshot.data as Record<string, unknown[]>;
  const delta = body.delta;

  // Process tombstones first (deletions)
  if (delta.tombstones && delta.tombstones.length > 0) {
    for (const tomb of delta.tombstones) {
      const tableName = tomb.table_name;
      const arr = data[tableName];
      if (Array.isArray(arr)) {
        data[tableName] = arr.filter((row: unknown) => {
          if (typeof row !== "object" || row === null) return true;
          const r = row as Record<string, unknown>;
          // Match by sync_key if available, else by uuid/id
          if (tomb.sync_key && r.sync_key === tomb.sync_key) return false;
          if (tomb.record_uuid && r.uuid === tomb.record_uuid) return false;
          if (
            tomb.record_id != null &&
            String(r.id) === String(tomb.record_id)
          )
            return false;
          return true;
        });
      }
    }
  }

  // Merge/upsert each table
  for (const tableName of [
    "projects",
    "applications",
    "sessions",
    "manual_sessions",
  ] as const) {
    const incoming = delta[tableName];
    if (!incoming || incoming.length === 0) continue;

    if (!Array.isArray(data[tableName])) {
      data[tableName] = [];
    }
    const existing = data[tableName] as Record<string, unknown>[];

    for (const row of incoming) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const idx = existing.findIndex((e) => {
        if (r.sync_key && e.sync_key === r.sync_key) return true;
        if (r.uuid && e.uuid === r.uuid) return true;
        if (r.id != null && e.id != null && String(r.id) === String(e.id))
          return true;
        return false;
      });
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...r };
      } else {
        existing.push(r);
      }
    }
  }

  snapshot.data = data;

  const archiveStr = JSON.stringify(snapshot);
  const hash = sha256(archiveStr);
  const now = new Date().toISOString();
  const newRevision = currentRevision + 1;

  await writeJson(path.join(dir, "snapshot.json"), snapshot);

  const newMeta: UserMeta = {
    revision: newRevision,
    payloadSha256: hash,
    tableHashes: body.tableHashes,
    updatedAt: now,
    createdAt: meta?.createdAt ?? now,
    deviceId: body.deviceId,
  };
  await writeJson(path.join(dir, "meta.json"), newMeta);

  log("info", "direct-sync.delta-push", {
    userId,
    deviceId: body.deviceId,
    baseRevision: body.baseRevision,
    newRevision,
    hash: hash.substring(0, 12),
    tombstones: delta.tombstones?.length ?? 0,
  });

  return {
    ok: true,
    accepted: true,
    revision: newRevision,
    serverTableHashes: body.tableHashes,
    reason: "delta_applied",
  };
}

export async function handleAck(
  userId: string,
  body: AckBody,
): Promise<AckResponse> {
  const dir = userDir(userId);
  const meta = await readJson<UserMeta>(path.join(dir, "meta.json"));

  if (!meta) {
    return {
      ok: true,
      accepted: false,
      revision: 0,
      payloadSha256: "",
      serverRevision: 0,
      serverHash: null,
      isLatest: false,
      reason: "no_server_data",
    };
  }

  const isLatest = body.revision === meta.revision;

  log("info", "direct-sync.ack", {
    userId,
    deviceId: body.deviceId,
    ackRevision: body.revision,
    serverRevision: meta.revision,
    isLatest,
  });

  return {
    ok: true,
    accepted: true,
    revision: body.revision,
    payloadSha256: body.payloadSha256,
    serverRevision: meta.revision,
    serverHash: meta.payloadSha256,
    isLatest,
    reason: isLatest ? "ack_latest" : "ack_outdated",
  };
}
