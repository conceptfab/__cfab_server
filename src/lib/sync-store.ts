import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  JsonValue,
  SyncAckRequest,
  SyncAckResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncStatusRequest,
  SyncStatusResponse,
  SyncStoreFile,
  UserSyncState,
} from "@/lib/sync-types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "sync-store.json");

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): SyncStoreFile {
  return { users: {} };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExportArchiveShape(value: unknown): boolean {
  if (!isObject(value)) return false;

  const hasTopLevelFields =
    isNonEmptyString(value.version) &&
    isNonEmptyString(value.exported_at) &&
    isNonEmptyString(value.machine_id) &&
    isNonEmptyString(value.export_type) &&
    isObject(value.date_range) &&
    isObject(value.metadata) &&
    isObject(value.data);

  if (!hasTopLevelFields) return false;

  const data = value.data;
  if (!isObject(data)) return false;

  return (
    Array.isArray(data.projects) &&
    Array.isArray(data.applications) &&
    Array.isArray(data.sessions) &&
    Array.isArray(data.manual_sessions) &&
    isObject(data.daily_files)
  );
}

function sha256Json(value: JsonValue): string {
  const serialized = JSON.stringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<SyncStoreFile> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !isObject(parsed.users)) {
      return emptyStore();
    }
    return parsed as unknown as SyncStoreFile;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyStore();
    }
    throw error;
  }
}

async function writeStore(store: SyncStoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function getOrCreateUser(store: SyncStoreFile, userId: string): UserSyncState {
  if (!store.users[userId]) {
    store.users[userId] = { devices: {} };
  }
  if (!store.users[userId].devices) {
    store.users[userId].devices = {};
  }
  return store.users[userId];
}

function updateDeviceHeartbeat(
  user: UserSyncState,
  deviceId: string,
  clientRevision?: number | null,
  clientHash?: string | null,
): void {
  user.devices[deviceId] = {
    lastSeenAt: nowIso(),
    lastClientRevision:
      typeof clientRevision === "number" && Number.isFinite(clientRevision)
        ? clientRevision
        : null,
    lastClientHash: clientHash ?? null,
  };
}

export function validateStatusRequest(body: unknown): SyncStatusRequest {
  if (!isObject(body)) {
    throw new Error("Invalid request body");
  }

  const userId = normalizeString(body.userId);
  const deviceId = normalizeString(body.deviceId);
  if (!userId || !deviceId) {
    throw new Error("userId and deviceId are required");
  }

  const clientRevision =
    typeof body.clientRevision === "number" && Number.isFinite(body.clientRevision)
      ? body.clientRevision
      : null;
  const clientHash = isNonEmptyString(body.clientHash) ? body.clientHash : null;

  return { userId, deviceId, clientRevision, clientHash };
}

export function validatePushRequest(body: unknown): SyncPushRequest {
  if (!isObject(body)) {
    throw new Error("Invalid request body");
  }

  const userId = normalizeString(body.userId);
  const deviceId = normalizeString(body.deviceId);
  if (!userId || !deviceId) {
    throw new Error("userId and deviceId are required");
  }

  if (!("archive" in body) || !hasExportArchiveShape(body.archive)) {
    throw new Error("archive is missing or has invalid shape");
  }

  const knownServerRevision =
    typeof body.knownServerRevision === "number" &&
    Number.isFinite(body.knownServerRevision)
      ? body.knownServerRevision
      : null;

  return {
    userId,
    deviceId,
    knownServerRevision,
    archive: body.archive as JsonValue,
  };
}

export function validatePullRequest(body: unknown): SyncPullRequest {
  if (!isObject(body)) {
    throw new Error("Invalid request body");
  }

  const userId = normalizeString(body.userId);
  const deviceId = normalizeString(body.deviceId);
  if (!userId || !deviceId) {
    throw new Error("userId and deviceId are required");
  }

  const clientRevision =
    typeof body.clientRevision === "number" && Number.isFinite(body.clientRevision)
      ? body.clientRevision
      : null;

  return { userId, deviceId, clientRevision };
}

export async function getSyncStatus(
  req: SyncStatusRequest,
): Promise<SyncStatusResponse> {
  const store = await readStore();
  const user = getOrCreateUser(store, req.userId);
  updateDeviceHeartbeat(user, req.deviceId, req.clientRevision, req.clientHash);
  await writeStore(store);

  const latest = user.latestSnapshot;
  if (!latest) {
    return {
      ok: true,
      userId: req.userId,
      deviceId: req.deviceId,
      serverOnline: true,
      serverRevision: 0,
      serverHash: null,
      serverUpdatedAt: null,
      hasServerData: false,
      shouldPush: true,
      shouldPull: false,
      reason: "server_has_no_snapshot",
    };
  }

  const clientRevision = req.clientRevision ?? 0;
  const hasServerNewer = latest.revision > clientRevision;
  const hasClientNewer = clientRevision > latest.revision;
  const sameHash = Boolean(req.clientHash && req.clientHash === latest.payloadSha256);
  const hashKnownAndDifferent = Boolean(req.clientHash && !sameHash);

  let shouldPull = false;
  let shouldPush = false;
  let reason = "in_sync";

  if (hasServerNewer && !sameHash) {
    shouldPull = true;
    reason = "server_revision_newer";
  } else if (hasClientNewer) {
    shouldPush = true;
    reason = "client_may_have_newer_data";
  } else if (hashKnownAndDifferent) {
    shouldPush = true;
    reason = "same_revision_hash_mismatch";
  } else if (sameHash) {
    reason = "same_hash";
  } else if (clientRevision === latest.revision) {
    reason = "same_revision_hash_not_provided";
  }

  return {
    ok: true,
    userId: req.userId,
    deviceId: req.deviceId,
    serverOnline: true,
    serverRevision: latest.revision,
    serverHash: latest.payloadSha256,
    serverUpdatedAt: latest.receivedAt,
    hasServerData: true,
    shouldPush,
    shouldPull,
    reason,
  };
}

export async function pushSnapshot(req: SyncPushRequest): Promise<SyncPushResponse> {
  const store = await readStore();
  const user = getOrCreateUser(store, req.userId);

  const payloadSha256 = sha256Json(req.archive);
  const current = user.latestSnapshot;
  const receivedAt = nowIso();

  updateDeviceHeartbeat(
    user,
    req.deviceId,
    req.knownServerRevision ?? current?.revision ?? null,
    payloadSha256,
  );

  if (current && current.payloadSha256 === payloadSha256) {
    await writeStore(store);
    return {
      ok: true,
      accepted: true,
      noOp: true,
      userId: req.userId,
      revision: current.revision,
      payloadSha256: current.payloadSha256,
      receivedAt: current.receivedAt,
      reason: "same_hash_noop",
    };
  }

  const nextRevision = (current?.revision ?? 0) + 1;
  user.latestSnapshot = {
    revision: nextRevision,
    payloadSha256,
    receivedAt,
    sourceDeviceId: req.deviceId,
    archive: req.archive,
  };

  await writeStore(store);

  return {
    ok: true,
    accepted: true,
    noOp: false,
    userId: req.userId,
    revision: nextRevision,
    payloadSha256,
    receivedAt,
    reason: "snapshot_saved",
  };
}

export async function pullSnapshot(req: SyncPullRequest): Promise<SyncPullResponse> {
  const store = await readStore();
  const user = getOrCreateUser(store, req.userId);
  updateDeviceHeartbeat(user, req.deviceId, req.clientRevision ?? null, null);

  const latest = user.latestSnapshot;
  if (!latest) {
    await writeStore(store);
    return {
      ok: true,
      hasUpdate: false,
      userId: req.userId,
      revision: null,
      payloadSha256: null,
      receivedAt: null,
      reason: "server_has_no_snapshot",
    };
  }

  const clientRevision = req.clientRevision ?? 0;
  if (latest.revision <= clientRevision) {
    await writeStore(store);
    return {
      ok: true,
      hasUpdate: false,
      userId: req.userId,
      revision: latest.revision,
      payloadSha256: latest.payloadSha256,
      receivedAt: latest.receivedAt,
      reason: "client_up_to_date",
    };
  }

  await writeStore(store);
  return {
    ok: true,
    hasUpdate: true,
    userId: req.userId,
    revision: latest.revision,
    payloadSha256: latest.payloadSha256,
    receivedAt: latest.receivedAt,
    archive: latest.archive,
    reason: "server_revision_newer",
  };
}

export function validateAckRequest(body: unknown): SyncAckRequest {
  if (!isObject(body)) {
    throw new Error("Invalid request body");
  }

  const userId = normalizeString(body.userId);
  const deviceId = normalizeString(body.deviceId);
  if (!userId || !deviceId) {
    throw new Error("userId and deviceId are required");
  }

  if (
    typeof body.revision !== "number" ||
    !Number.isFinite(body.revision) ||
    body.revision < 0
  ) {
    throw new Error("revision must be a non-negative finite number");
  }

  if (!isNonEmptyString(body.payloadSha256)) {
    throw new Error("payloadSha256 is required");
  }

  return {
    userId,
    deviceId,
    revision: body.revision,
    payloadSha256: body.payloadSha256,
  };
}

export async function processAck(req: SyncAckRequest): Promise<SyncAckResponse> {
  const store = await readStore();
  const user = getOrCreateUser(store, req.userId);
  updateDeviceHeartbeat(user, req.deviceId, req.revision, req.payloadSha256);

  const latest = user.latestSnapshot;

  if (!latest) {
    await writeStore(store);
    return {
      ok: true,
      accepted: false,
      isLatest: false,
      serverRevision: 0,
      serverHash: null,
      reason: "unknown_revision",
    };
  }

  if (latest.revision !== req.revision) {
    await writeStore(store);
    return {
      ok: true,
      accepted: false,
      isLatest: false,
      serverRevision: latest.revision,
      serverHash: latest.payloadSha256,
      reason: "unknown_revision",
    };
  }

  if (latest.payloadSha256 !== req.payloadSha256) {
    await writeStore(store);
    return {
      ok: true,
      accepted: false,
      isLatest: true,
      serverRevision: latest.revision,
      serverHash: latest.payloadSha256,
      reason: "hash_mismatch_for_revision",
    };
  }

  await writeStore(store);
  return {
    ok: true,
    accepted: true,
    isLatest: true,
    serverRevision: latest.revision,
    serverHash: latest.payloadSha256,
    reason: "ack_accepted",
  };
}
