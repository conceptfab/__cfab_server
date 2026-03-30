import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TableHashes } from "@/lib/sync/contracts";
import type {
  SessionStoreFile,
  StorageCredentials,
  SyncSession,
  SyncSessionStatus,
  SyncStepLog,
} from "@/lib/sync/session-contracts";

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "session-store.json");

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const HEARTBEAT_SLIDE_MS = 2 * 60 * 1000; // 2 minutes

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
  return { version: 1, sessions: {} };
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
      return parsed as SessionStoreFile;
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
    const TERMINAL_STATES = ["completed", "failed", "expired", "cancelled"];
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
    const TERMINAL_STATES_HB = ["completed", "failed", "expired", "cancelled"];
    if (TERMINAL_STATES_HB.includes(session.status)) {
      return session;
    }

    // I3: Only extend TTL, never reduce it
    const newExpiry = new Date(Date.now() + HEARTBEAT_SLIDE_MS).toISOString();
    if (newExpiry > session.expiresAt) {
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
    const TERMINAL_STATES_CS = ["completed", "failed", "expired", "cancelled"];
    if (TERMINAL_STATES_CS.includes(session.status)) {
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
