/**
 * Direct Sync — simple revision-based sync for desktop Tauri clients.
 *
 * Storage layout (per user):
 *   DATA_DIR/online-sync/<userId>/meta.json      — revision, hash, timestamps
 *   DATA_DIR/online-sync/<userId>/snapshot.json.gz — gzip-compressed data archive
 *   DATA_DIR/online-sync/_history.json            — recent sync history entries
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";

import type { TableHashes, DeltaData } from "./contracts";
import { log } from "@/lib/observability/logger";
import { touchDeviceLastSeen, updateDeviceLastSync, getDevicesForUser, getDevice, getDevicesForLicense } from "./license-store";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const REPO_DIR = path.join(DATA_DIR, "online-sync");
const HISTORY_FILE = path.join(REPO_DIR, "_history.json");
const MAX_HISTORY_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectSyncHistoryEntry {
  id: string;
  userId: string;
  deviceId: string;
  action: "push" | "delta-push" | "pull" | "ack" | "status" | "test";
  revision: number;
  hash: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  status: "ok" | "noop" | "error";
  detail: string;
  timestamp: string;
}

interface UserMeta {
  revision: number;
  payloadSha256: string;
  diskBytes?: number;
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
  clientHash?: string | null;
  tableHashes?: TableHashes;
}

export type SyncCommand = "idle" | "send_delta" | "send_full" | "pull";

export interface StatusResponse {
  ok: true;
  command: SyncCommand;
  serverRevision: number;
  serverHash: string | null;
  onlineDevices: number;
  reason: string;
  // Legacy compat — derived from command
  shouldPush: boolean;
  shouldPull: boolean;
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
  snapshotHash: string | null;
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

/** Write snapshot as gzip-compressed JSON (.json.gz) */
async function writeSnapshotGz(filePath: string, data: unknown): Promise<number> {
  const json = JSON.stringify(data);
  const compressed = gzipSync(Buffer.from(json, "utf8"));
  const gzPath = filePath.replace(/\.json$/, ".json.gz");
  await writeFile(gzPath, compressed);
  return compressed.length;
}

/** Read snapshot — try .json.gz first, fall back to .json for migration */
async function readSnapshot<T>(filePath: string): Promise<T | null> {
  const gzPath = filePath.replace(/\.json$/, ".json.gz");
  try {
    const compressed = await readFile(gzPath);
    const raw = gunzipSync(compressed).toString("utf8");
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
      // .gz not found — try plain .json (pre-migration)
      return readJson<T>(filePath);
    }
    throw error;
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function appendHistory(entry: DirectSyncHistoryEntry): Promise<void> {
  try {
    await ensureDir(REPO_DIR);
    const existing = (await readJson<DirectSyncHistoryEntry[]>(HISTORY_FILE)) ?? [];
    existing.unshift(entry);
    if (existing.length > MAX_HISTORY_ENTRIES) {
      existing.length = MAX_HISTORY_ENTRIES;
    }
    await writeJson(HISTORY_FILE, existing);
  } catch (err) {
    log("warn", "direct-sync.history.write-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getDirectSyncHistory(): Promise<DirectSyncHistoryEntry[]> {
  return (await readJson<DirectSyncHistoryEntry[]>(HISTORY_FILE)) ?? [];
}

export async function clearDirectSyncHistory(): Promise<{ cleared: number }> {
  const existing = (await readJson<DirectSyncHistoryEntry[]>(HISTORY_FILE)) ?? [];
  const count = existing.length;
  await ensureDir(REPO_DIR);
  await writeJson(HISTORY_FILE, []);
  return { cleared: count };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleStatus(
  userId: string,
  body: StatusBody,
): Promise<StatusResponse> {
  // 1. Register heartbeat
  touchDeviceLastSeen(body.deviceId).catch(() => {});

  // 2. Count online devices (seen in last 5 min)
  //    First try to find peers via the device's license (works regardless of
  //    group.ownerId).  Fall back to getDevicesForUser for env-token users
  //    that may not have a license-store entry.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const requestingDevice = await getDevice(body.deviceId);
  const allDevices = requestingDevice
    ? await getDevicesForLicense(requestingDevice.licenseId)
    : await getDevicesForUser(userId);
  const onlineCount = allDevices.filter(
    (d) => d.lastSeenAt && new Date(d.lastSeenAt).getTime() > fiveMinAgo,
  ).length;

  const dir = userDir(userId);
  const meta = await readJson<UserMeta>(path.join(dir, "meta.json"));

  function reply(command: SyncCommand, reason: string): StatusResponse {
    appendHistory({
      id: randomUUID(),
      userId,
      deviceId: body.deviceId,
      action: "status",
      revision: meta?.revision ?? 0,
      hash: meta?.payloadSha256?.substring(0, 12) ?? null,
      sizeBytes: null,
      durationMs: null,
      status: "ok",
      detail: `${command} (${reason})`,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return {
      ok: true,
      command,
      serverRevision: meta?.revision ?? 0,
      serverHash: meta?.payloadSha256 ?? null,
      onlineDevices: onlineCount,
      reason,
      shouldPush: command === "send_delta" || command === "send_full",
      shouldPull: command === "pull",
    };
  }

  // 3. No data on server — need initial baseline
  if (!meta) {
    return reply("send_full", "no_server_data");
  }

  // 4. Client behind server — always pull, even if only one device is online.
  //    Data may have been pushed by another device that's now offline.
  const clientRev = body.clientRevision ?? 0;

  if (clientRev < meta.revision) {
    return reply("pull", "client_behind");
  }

  // 5. Single device — heartbeat only, no push needed
  if (onlineCount <= 1) {
    return reply("idle", "single_device");
  }

  // 6. Multiple devices online — determine sync command
  if (clientRev > meta.revision) {
    return reply("send_delta", "client_ahead");
  }

  // Same revision — check if data actually differs
  const hashMatch =
    body.clientHash != null &&
    meta.payloadSha256 != null &&
    body.clientHash === meta.payloadSha256;

  if (hashMatch) {
    return reply("idle", "in_sync");
  }

  if (body.tableHashes && meta.tableHashes) {
    const tablesMatch =
      body.tableHashes.projects === meta.tableHashes.projects &&
      body.tableHashes.applications === meta.tableHashes.applications &&
      body.tableHashes.sessions === meta.tableHashes.sessions &&
      body.tableHashes.manual_sessions === meta.tableHashes.manual_sessions;
    if (tablesMatch) {
      return reply("idle", "table_hashes_match");
    }
  }

  // Same revision, different hash — client has diverged data, request delta push
  return reply("send_delta", "same_revision_hash_drift");
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

  const diskBytes = await writeSnapshotGz(path.join(dir, "snapshot.json"), body.archive);

  const meta: UserMeta = {
    revision: newRevision,
    payloadSha256: hash,
    diskBytes,
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

  updateDeviceLastSync(body.deviceId, hash).catch(() => {});
  appendHistory({
    id: randomUUID(),
    userId,
    deviceId: body.deviceId,
    action: "push",
    revision: newRevision,
    hash: hash.substring(0, 12),
    sizeBytes: archiveStr.length,
    durationMs: null,
    status: "ok",
    detail: "full archive push accepted",
    timestamp: now,
  }).catch(() => {});

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

  const snapshot = await readSnapshot<SnapshotArchive>(
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

  appendHistory({
    id: randomUUID(),
    userId,
    deviceId: body.deviceId,
    action: "pull",
    revision: meta.revision,
    hash: meta.payloadSha256?.substring(0, 12) ?? null,
    sizeBytes: null,
    durationMs: null,
    status: "ok",
    detail: `pull r${body.clientRevision} → r${meta.revision}`,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

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

  // Check if delta is empty (no changes to apply)
  const delta = body.delta;
  const hasChanges =
    (delta.projects?.length ?? 0) > 0 ||
    (delta.applications?.length ?? 0) > 0 ||
    (delta.sessions?.length ?? 0) > 0 ||
    (delta.manual_sessions?.length ?? 0) > 0 ||
    (delta.tombstones?.length ?? 0) > 0;

  if (!hasChanges) {
    // Nothing to merge — return current state without bumping revision
    return {
      ok: true,
      accepted: true,
      revision: currentRevision,
      snapshotHash: meta?.payloadSha256 ?? null,
      serverTableHashes: body.tableHashes,
      reason: "noop_empty_delta",
    };
  }

  // Load existing snapshot or start fresh
  let snapshot =
    (await readSnapshot<SnapshotArchive>(path.join(dir, "snapshot.json"))) ?? {
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
  const previousHash = meta?.payloadSha256 ?? null;

  // If snapshot hash didn't change after merge, it's a noop — don't bump revision
  if (previousHash && hash === previousHash) {
    log("info", "direct-sync.delta-push.noop-same-hash", {
      userId,
      deviceId: body.deviceId,
      revision: currentRevision,
      hash: hash.substring(0, 12),
    });

    // Update tableHashes in meta even if snapshot didn't change
    if (meta) {
      meta.tableHashes = body.tableHashes;
      await writeJson(path.join(dir, "meta.json"), meta);
    }

    return {
      ok: true,
      accepted: true,
      revision: currentRevision,
      snapshotHash: hash,
      serverTableHashes: body.tableHashes,
      reason: "noop_same_snapshot",
    };
  }

  const now = new Date().toISOString();
  const newRevision = currentRevision + 1;

  const diskBytes = await writeSnapshotGz(path.join(dir, "snapshot.json"), snapshot);

  const newMeta: UserMeta = {
    revision: newRevision,
    payloadSha256: hash,
    diskBytes,
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

  updateDeviceLastSync(body.deviceId, hash).catch(() => {});
  appendHistory({
    id: randomUUID(),
    userId,
    deviceId: body.deviceId,
    action: "delta-push",
    revision: newRevision,
    hash: hash.substring(0, 12),
    sizeBytes: JSON.stringify(delta).length,
    durationMs: null,
    status: "ok",
    detail: `delta r${body.baseRevision} → r${newRevision}, ${delta.tombstones?.length ?? 0} tombstones`,
    timestamp: now,
  }).catch(() => {});

  return {
    ok: true,
    accepted: true,
    revision: newRevision,
    snapshotHash: hash,
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

// ---------------------------------------------------------------------------
// Test roundtrip — write test payload, read it back, delete, return proof
// ---------------------------------------------------------------------------

export interface TestRoundtripBody {
  userId: string;
  deviceId: string;
  testPayload: Record<string, unknown>;
}

export interface TestRoundtripResponse {
  ok: true;
  steps: {
    write: { success: boolean; path: string; sizeBytes: number; diskBytes: number };
    read: { success: boolean; matches: boolean };
    cleanup: { success: boolean };
  };
  echoPayload: Record<string, unknown>;
  serverTimestamp: string;
  roundtripMs: number;
}

export async function handleTestRoundtrip(
  userId: string,
  body: TestRoundtripBody,
): Promise<TestRoundtripResponse> {
  const t0 = Date.now();
  const dir = userDir(userId);
  await ensureDir(dir);

  const testFile = path.join(dir, "_test_roundtrip.json");
  const envelope = {
    userId,
    deviceId: body.deviceId,
    testPayload: body.testPayload,
    writtenAt: new Date().toISOString(),
  };
  const envelopeStr = JSON.stringify(envelope);

  // Step 1: Write as gzip
  let writeOk = false;
  let diskBytes = 0;
  try {
    diskBytes = await writeSnapshotGz(testFile, envelope);
    writeOk = true;
  } catch (err) {
    log("error", "direct-sync.test-roundtrip.write-failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: Read back (gzip) and compare
  let readOk = false;
  let matches = false;
  try {
    const readBack = await readSnapshot<typeof envelope>(testFile);
    readOk = true;
    matches =
      readBack !== null &&
      JSON.stringify(readBack.testPayload) ===
        JSON.stringify(body.testPayload);
  } catch (err) {
    log("error", "direct-sync.test-roundtrip.read-failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3: Cleanup (.json.gz file)
  let cleanupOk = false;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(testFile.replace(/\.json$/, ".json.gz"));
    cleanupOk = true;
  } catch {
    // file may not exist if write failed
    cleanupOk = true;
  }

  // Touch device
  touchDeviceLastSeen(body.deviceId).catch(() => {});

  const roundtripMs = Date.now() - t0;

  const compressionRatio = diskBytes > 0 ? ((1 - diskBytes / envelopeStr.length) * 100).toFixed(0) : "0";

  log("info", "direct-sync.test-roundtrip", {
    userId,
    deviceId: body.deviceId,
    writeOk,
    readOk,
    matches,
    rawBytes: envelopeStr.length,
    diskBytes,
    compressionRatio: `${compressionRatio}%`,
    roundtripMs,
  });

  appendHistory({
    id: randomUUID(),
    userId,
    deviceId: body.deviceId,
    action: "test",
    revision: 0,
    hash: null,
    sizeBytes: diskBytes,
    durationMs: roundtripMs,
    status: writeOk && readOk && matches ? "ok" : "error",
    detail: `test ${(diskBytes / 1024).toFixed(0)} KB gzip (${(envelopeStr.length / 1024).toFixed(0)} KB raw, ${compressionRatio}%) write=${writeOk} read=${readOk} match=${matches}`,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  return {
    ok: true,
    steps: {
      write: { success: writeOk, path: testFile, sizeBytes: envelopeStr.length, diskBytes },
      read: { success: readOk, matches },
      cleanup: { success: cleanupOk },
    },
    echoPayload: body.testPayload,
    serverTimestamp: new Date().toISOString(),
    roundtripMs,
  };
}
