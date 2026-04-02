import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TableHashes } from "@/lib/sync/contracts";
import type {
  AsyncDeltaPackage,
  SessionStoreFile,
  StorageCredentials,
  SyncHistoryEntry,
  SyncSession,
  SyncSessionStatus,
  SyncStepLog,
} from "@/lib/sync/session-contracts";

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "session-store.json");

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const HEARTBEAT_SLIDE_MS = 2 * 60 * 1000; // 2 minutes
const TERMINAL_STATES: SyncSessionStatus[] = ["completed", "failed", "expired", "cancelled"];

// ---------------------------------------------------------------------------
// Phase mapping
// ---------------------------------------------------------------------------

export function stepToPhase(step: number): string {
  if (step <= 2) return "discovery";
  if (step <= 4) return "negotiation";
  if (step <= 7) return "transfer";
  if (step <= 10) return "merge";
  return "distribute";
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): SessionStoreFile {
  return { version: 1, sessions: {}, asyncPackages: {}, syncHistory: [] };
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<SessionStoreFile> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "sessions" in parsed
    ) {
      const store = parsed as SessionStoreFile;
      // Backfill for older store files
      if (!store.asyncPackages) {
        store.asyncPackages = {};
      }
      if (!store.syncHistory) {
        store.syncHistory = [];
      }
      return store;
    }
    return emptyStore();
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

async function writeStore(store: SessionStoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Mutex (same pattern as repository.ts)
// ---------------------------------------------------------------------------

let mutex: Promise<void> = Promise.resolve();

async function withMutex<T>(work: () => Promise<T>): Promise<T> {
  const previous = mutex;
  let release: () => void = () => {};
  mutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function createSession(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: TableHashes | null,
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const now = nowIso();
    const session: SyncSession = {
      id: randomUUID(),
      userId,
      status: "awaiting_peer",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      masterDeviceId: deviceId,
      slaveDeviceId: null,
      syncMode: null,
      masterMarkerHash: markerHash,
      slaveMarkerHash: null,
      masterTableHashes: tableHashes,
      slaveTableHashes: null,
      currentStep: 0,
      stepLog: [],
      storageSessionPath: null,
      storageCredentials: null,
      storageCredentialsSentAt: null,
      resultMarkerHash: null,
      completedAt: null,
      errorMessage: null,
    };
    store.sessions[session.id] = session;
    await writeStore(store);
    return session;
  });
}

export async function findAwaitingSession(
  userId: string,
  excludeDeviceId: string,
): Promise<SyncSession | null> {
  return withMutex(async () => {
    const store = await readStore();
    for (const session of Object.values(store.sessions)) {
      if (
        session.userId === userId &&
        session.status === "awaiting_peer" &&
        session.masterDeviceId !== excludeDeviceId &&
        new Date(session.expiresAt).getTime() > Date.now()
      ) {
        return session;
      }
    }
    return null;
  });
}

export async function joinSession(
  sessionId: string,
  slaveDeviceId: string,
  slaveMarkerHash: string | null,
  slaveTableHashes: TableHashes | null,
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== "awaiting_peer") {
      throw new Error(`Session ${sessionId} is not awaiting peer (status: ${session.status})`);
    }

    session.slaveDeviceId = slaveDeviceId;
    session.slaveMarkerHash = slaveMarkerHash;
    session.slaveTableHashes = slaveTableHashes;
    session.status = "negotiating";
    session.updatedAt = nowIso();

    // Determine sync mode: delta if both markers match, full otherwise
    if (
      session.masterMarkerHash &&
      slaveMarkerHash &&
      session.masterMarkerHash === slaveMarkerHash
    ) {
      session.syncMode = "delta";
    } else {
      session.syncMode = "full";
    }

    await writeStore(store);
    return session;
  });
}

// C1: Atomic find-and-join-or-create to prevent race conditions in session pairing
export async function findAndJoinOrCreate(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: TableHashes | null,
): Promise<{ session: SyncSession; role: "master" | "slave" }> {
  return withMutex(async () => {
    const store = await readStore();
    const now = Date.now();

    // Find existing awaiting session for this user (different device)
    for (const session of Object.values(store.sessions)) {
      if (
        session.userId === userId &&
        session.status === "awaiting_peer" &&
        session.masterDeviceId !== deviceId &&
        new Date(session.expiresAt).getTime() > now
      ) {
        // Join as slave
        const ts = nowIso();
        session.slaveDeviceId = deviceId;
        session.slaveMarkerHash = markerHash;
        session.slaveTableHashes = tableHashes;
        session.status = "negotiating";
        session.currentStep = 2;
        session.updatedAt = ts;

        if (
          session.masterMarkerHash &&
          markerHash &&
          session.masterMarkerHash === markerHash
        ) {
          session.syncMode = "delta";
        } else {
          session.syncMode = "full";
        }

        session.stepLog.push({
          step: 2,
          phase: "discovery",
          action: "slave_joined",
          deviceId,
          timestamp: ts,
          details: { slaveMarkerHash: markerHash, syncMode: session.syncMode },
          status: "ok",
        });

        await writeStore(store);
        return { session, role: "slave" as const };
      }
    }

    // Create new session as master
    const ts = nowIso();
    const newSession: SyncSession = {
      id: randomUUID(),
      userId,
      status: "awaiting_peer",
      createdAt: ts,
      updatedAt: ts,
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      masterDeviceId: deviceId,
      slaveDeviceId: null,
      syncMode: null,
      masterMarkerHash: markerHash,
      slaveMarkerHash: null,
      masterTableHashes: tableHashes,
      slaveTableHashes: null,
      currentStep: 1,
      stepLog: [
        {
          step: 1,
          phase: "discovery",
          action: "session_created",
          deviceId,
          timestamp: ts,
          details: { markerHash },
          status: "ok",
        },
      ],
      storageSessionPath: null,
      storageCredentials: null,
      storageCredentialsSentAt: null,
      resultMarkerHash: null,
      completedAt: null,
      errorMessage: null,
    };
    store.sessions[newSession.id] = newSession;
    await writeStore(store);
    return { session: newSession, role: "master" as const };
  });
}

export async function getAllSessions(): Promise<SyncSession[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.sessions);
  });
}

export async function getSession(sessionId: string): Promise<SyncSession | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.sessions[sessionId] ?? null;
  });
}

export async function reportStep(
  sessionId: string,
  step: number,
  action: string,
  deviceId: string,
  details: Record<string, unknown>,
  status: "ok" | "error" | "warning",
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // C2: Ignore reports to terminal sessions
    if (TERMINAL_STATES.includes(session.status)) {
      return session;
    }

    // I6: Validate step range
    if (step < 1 || step > 13) {
      return session;
    }

    const logEntry: SyncStepLog = {
      step,
      phase: stepToPhase(step),
      action,
      deviceId,
      timestamp: nowIso(),
      details,
      status,
    };
    session.stepLog.push(logEntry);

    if (step > session.currentStep) {
      session.currentStep = step;
    }
    session.updatedAt = nowIso();

    // Handle error status
    if (status === "error") {
      session.status = "failed";
      session.errorMessage = details.error as string ?? action;

      // Record failed session in history
      const startTime = new Date(session.createdAt).getTime();
      const historyEntry: SyncHistoryEntry = {
        id: randomUUID(),
        sessionId: session.id,
        masterDeviceId: session.masterDeviceId,
        slaveDeviceId: session.slaveDeviceId,
        syncMode: session.syncMode,
        resultMarkerHash: null,
        startedAt: session.createdAt,
        completedAt: nowIso(),
        durationMs: Date.now() - startTime,
        status: "failed",
        errorMessage: session.errorMessage,
        stepCount: session.stepLog.length,
      };
      store.syncHistory!.push(historyEntry);
    }

    // Completion detection: both devices reported step 13
    if (step >= 13 && status === "ok") {
      const devicesAtStep13 = new Set(
        session.stepLog
          .filter((log) => log.step >= 13 && log.status === "ok")
          .map((log) => log.deviceId),
      );
      const masterReported = devicesAtStep13.has(session.masterDeviceId);
      const slaveReported = session.slaveDeviceId
        ? devicesAtStep13.has(session.slaveDeviceId)
        : false;

      if (masterReported && slaveReported) {
        session.status = "completed";
        session.completedAt = nowIso();

        // Record sync history entry
        const startTime = new Date(session.createdAt).getTime();
        const endTime = Date.now();
        const historyEntry: SyncHistoryEntry = {
          id: randomUUID(),
          sessionId: session.id,
          masterDeviceId: session.masterDeviceId,
          slaveDeviceId: session.slaveDeviceId,
          syncMode: session.syncMode,
          resultMarkerHash: session.resultMarkerHash,
          startedAt: session.createdAt,
          completedAt: session.completedAt!,
          durationMs: endTime - startTime,
          status: "completed",
          errorMessage: null,
          stepCount: session.stepLog.length,
        };
        store.syncHistory!.push(historyEntry);
      }
    }

    // Move to in_progress if still negotiating and step > 0
    if (session.status === "negotiating" && step > 0 && status === "ok") {
      session.status = "in_progress";
    }

    await writeStore(store);
    return session;
  });
}

export async function heartbeat(
  sessionId: string,
  _deviceId: string,
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // C2: Ignore heartbeats to terminal sessions
    if (TERMINAL_STATES.includes(session.status)) {
      return session;
    }

    // I3: Only extend TTL, never reduce it
    const newExpiry = new Date(Date.now() + HEARTBEAT_SLIDE_MS).toISOString();
    if (new Date(newExpiry).getTime() > new Date(session.expiresAt).getTime()) {
      session.expiresAt = newExpiry;
    }
    session.updatedAt = nowIso();

    await writeStore(store);
    return session;
  });
}

export async function cancelSession(
  sessionId: string,
  _deviceId: string,
  reason?: string,
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // C2: Ignore cancellation of terminal sessions
    if (TERMINAL_STATES.includes(session.status)) {
      return session;
    }

    session.status = "cancelled";
    session.updatedAt = nowIso();
    if (reason) {
      session.errorMessage = reason;
    }

    await writeStore(store);
    return session;
  });
}

export async function expireSessions(): Promise<number> {
  return withMutex(async () => {
    const store = await readStore();
    const now = Date.now();
    let count = 0;

    for (const session of Object.values(store.sessions)) {
      if (
        (session.status === "awaiting_peer" ||
          session.status === "negotiating" ||
          session.status === "in_progress") &&
        new Date(session.expiresAt).getTime() <= now
      ) {
        session.status = "expired";
        session.updatedAt = nowIso();
        count++;
      }
    }

    if (count > 0) {
      await writeStore(store);
    }
    return count;
  });
}

export async function cleanupOldSessions(maxAgeMs: number): Promise<number> {
  return withMutex(async () => {
    const store = await readStore();
    const cutoff = Date.now() - maxAgeMs;
    const terminalStatuses: SyncSessionStatus[] = [
      "completed",
      "failed",
      "expired",
      "cancelled",
    ];
    let count = 0;

    for (const [id, session] of Object.entries(store.sessions)) {
      if (
        terminalStatuses.includes(session.status) &&
        new Date(session.updatedAt).getTime() < cutoff
      ) {
        delete store.sessions[id];
        count++;
      }
    }

    if (count > 0) {
      await writeStore(store);
    }
    return count;
  });
}

// ---------------------------------------------------------------------------
// Atomic get + validate ownership + action
// ---------------------------------------------------------------------------

/**
 * Atomically: read store → validate session ownership → perform action → write store.
 * The action callback receives the validated session and must mutate it in place.
 * The store is written back after the action completes.
 */
export async function withValidatedSession(
  sessionId: string,
  userId: string,
  deviceId: string,
  action: (session: SyncSession) => void,
): Promise<SyncSession> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.userId !== userId) {
      throw new Error("Session does not belong to this user");
    }
    if (session.masterDeviceId !== deviceId && session.slaveDeviceId !== deviceId) {
      throw new Error("Device is not part of this session");
    }
    action(session);
    await writeStore(store);
    return session;
  });
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export async function updateSessionStorage(
  sessionId: string,
  storagePath: string,
  credentials: StorageCredentials,
): Promise<void> {
  return withMutex(async () => {
    const store = await readStore();
    const session = store.sessions[sessionId];
    if (!session) return;
    session.storageSessionPath = storagePath;
    session.storageCredentials = credentials;
    session.storageCredentialsSentAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await writeStore(store);
  });
}

/** Get IDs of sessions in terminal state that have a storageSessionPath */
export async function getCompletedSessionIds(): Promise<string[]> {
  return withMutex(async () => {
    const store = await readStore();
    const terminal = ["completed", "failed", "expired", "cancelled"];
    return Object.values(store.sessions)
      .filter((s) => terminal.includes(s.status) && s.storageSessionPath)
      .map((s) => s.id);
  });
}

/** Get IDs of sessions in active (non-terminal) state */
export async function getActiveSessionIds(): Promise<string[]> {
  return withMutex(async () => {
    const store = await readStore();
    const terminal = ["completed", "failed", "expired", "cancelled"];
    return Object.values(store.sessions)
      .filter((s) => !terminal.includes(s.status))
      .map((s) => s.id);
  });
}

// ---------------------------------------------------------------------------
// Async delta packages
// ---------------------------------------------------------------------------

export async function createAsyncPackage(
  pkg: AsyncDeltaPackage,
): Promise<void> {
  return withMutex(async () => {
    const store = await readStore();
    store.asyncPackages![pkg.id] = pkg;
    await writeStore(store);
  });
}

export async function getAsyncPackage(
  packageId: string,
): Promise<AsyncDeltaPackage | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.asyncPackages?.[packageId] ?? null;
  });
}

export async function getAllAsyncPackages(): Promise<AsyncDeltaPackage[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.asyncPackages ?? {});
  });
}

export async function getPendingPackagesForGroup(
  groupId: string,
  excludeDeviceId: string,
): Promise<AsyncDeltaPackage[]> {
  return withMutex(async () => {
    const store = await readStore();
    const now = Date.now();
    return Object.values(store.asyncPackages ?? {}).filter(
      (p) =>
        p.groupId === groupId &&
        p.status === "pending" &&
        p.fromDeviceId !== excludeDeviceId &&
        new Date(p.expiresAt).getTime() > now,
    );
  });
}

export async function updateAsyncPackageStatus(
  packageId: string,
  status: AsyncDeltaPackage["status"],
  extra?: { deliveredToDeviceId?: string },
): Promise<AsyncDeltaPackage | null> {
  return withMutex(async () => {
    const store = await readStore();
    const pkg = store.asyncPackages?.[packageId];
    if (!pkg) return null;
    pkg.status = status;
    if (status === "delivered") {
      pkg.deliveredAt = nowIso();
      if (extra?.deliveredToDeviceId) {
        pkg.deliveredToDeviceId = extra.deliveredToDeviceId;
      }
    }
    await writeStore(store);
    return pkg;
  });
}

export async function expireAsyncPackages(): Promise<number> {
  return withMutex(async () => {
    const store = await readStore();
    const now = Date.now();
    let count = 0;
    for (const pkg of Object.values(store.asyncPackages ?? {})) {
      if (
        pkg.status === "pending" &&
        new Date(pkg.expiresAt).getTime() <= now
      ) {
        pkg.status = "expired";
        count++;
      }
    }
    if (count > 0) await writeStore(store);
    return count;
  });
}

export async function cleanupOldAsyncPackages(maxAgeMs: number): Promise<number> {
  return withMutex(async () => {
    const store = await readStore();
    const cutoff = Date.now() - maxAgeMs;
    const terminal: AsyncDeltaPackage["status"][] = ["delivered", "rejected", "expired"];
    let count = 0;
    for (const [id, pkg] of Object.entries(store.asyncPackages ?? {})) {
      if (
        terminal.includes(pkg.status) &&
        new Date(pkg.createdAt).getTime() < cutoff
      ) {
        delete store.asyncPackages![id];
        count++;
      }
    }
    if (count > 0) await writeStore(store);
    return count;
  });
}

/** Get expired/delivered/rejected async packages that still have storage paths */
export async function getCleanableAsyncPackageIds(): Promise<{ id: string; storagePath: string }[]> {
  return withMutex(async () => {
    const store = await readStore();
    const terminal: AsyncDeltaPackage["status"][] = ["delivered", "rejected", "expired"];
    return Object.values(store.asyncPackages ?? {})
      .filter((p) => terminal.includes(p.status) && p.storagePath)
      .map((p) => ({ id: p.id, storagePath: p.storagePath }));
  });
}

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export async function getSyncHistory(
  limit = 50,
  offset = 0,
): Promise<{ entries: SyncHistoryEntry[]; total: number }> {
  return withMutex(async () => {
    const store = await readStore();
    const history = store.syncHistory ?? [];
    // Sort newest first
    const sorted = [...history].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return {
      entries: sorted.slice(offset, offset + limit),
      total: sorted.length,
    };
  });
}

export async function getSyncHistoryEntry(
  entryId: string,
): Promise<SyncHistoryEntry | null> {
  return withMutex(async () => {
    const store = await readStore();
    return (store.syncHistory ?? []).find((e) => e.id === entryId) ?? null;
  });
}

export async function getSyncHistoryForUser(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ entries: SyncHistoryEntry[]; total: number }> {
  return withMutex(async () => {
    const store = await readStore();
    // To filter by user, we need to look up the session's userId
    // For now, filter by checking sessions that belong to this user
    const userSessionIds = new Set(
      Object.values(store.sessions)
        .filter((s) => s.userId === userId)
        .map((s) => s.id),
    );
    const history = (store.syncHistory ?? []).filter((e) =>
      userSessionIds.has(e.sessionId),
    );
    const sorted = [...history].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return {
      entries: sorted.slice(offset, offset + limit),
      total: sorted.length,
    };
  });
}
