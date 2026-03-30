import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TableHashes } from "@/lib/sync/contracts";
import type {
  SessionStoreFile,
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

    session.expiresAt = new Date(Date.now() + HEARTBEAT_SLIDE_MS).toISOString();
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
