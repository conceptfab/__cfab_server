import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { TableHashes } from "@/lib/sync/contracts";
import type {
  AsyncDeltaPackage,
  StorageCredentials,
  SyncHistoryEntry,
  SyncSession,
  SyncSessionStatus,
  SyncStepLog,
} from "@/lib/sync/session-contracts";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const HEARTBEAT_SLIDE_MS = 2 * 60 * 1000; // 2 minutes
const TERMINAL_STATES: SyncSessionStatus[] = ["completed", "failed", "expired", "cancelled"];

/** Cast domain objects to Prisma's JSON input type without leaking `any`. */
function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

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
// Prisma ↔ domain mappers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma row JSON fields are loosely typed
function dbToSession(row: any): SyncSession {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as SyncSessionStatus,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    masterDeviceId: row.masterDeviceId,
    slaveDeviceId: row.slaveDeviceId,
    syncMode: row.syncMode,
    masterMarkerHash: row.masterMarkerHash,
    slaveMarkerHash: row.slaveMarkerHash,
    masterTableHashes: row.masterTableHashes as TableHashes | null,
    slaveTableHashes: row.slaveTableHashes as TableHashes | null,
    currentStep: row.currentStep,
    stepLog: (row.stepLog ?? []) as SyncStepLog[],
    storageSessionPath: row.storageSessionPath,
    storageCredentials: row.storageCredentials as StorageCredentials | null,
    storageCredentialsSentAt: row.storageCredentialsSentAt instanceof Date
      ? row.storageCredentialsSentAt.toISOString()
      : row.storageCredentialsSentAt,
    resultMarkerHash: row.resultMarkerHash,
    completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt,
    errorMessage: row.errorMessage,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma row JSON fields are loosely typed
function dbToHistory(row: any): SyncHistoryEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    masterDeviceId: row.masterDeviceId,
    slaveDeviceId: row.slaveDeviceId,
    syncMode: row.syncMode,
    resultMarkerHash: row.resultMarkerHash,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
    completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt,
    durationMs: row.durationMs,
    status: row.status as "completed" | "failed",
    errorMessage: row.errorMessage,
    stepCount: row.stepCount,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma row JSON fields are loosely typed
function dbToAsyncPackage(row: any): AsyncDeltaPackage {
  return {
    id: row.id,
    groupId: row.groupId,
    fromDeviceId: row.fromDeviceId,
    toGroupDevices: row.toGroupDevices,
    baseMarkerHash: row.baseMarkerHash,
    newMarkerHash: row.newMarkerHash,
    storagePath: row.storagePath,
    storageBackendId: row.storageBackendId,
    status: row.status as AsyncDeltaPackage["status"],
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    deliveredAt: row.deliveredAt instanceof Date ? row.deliveredAt.toISOString() : row.deliveredAt,
    deliveredToDeviceId: row.deliveredToDeviceId,
    keyScheme: (row.keyScheme ?? "v1-groupid") as AsyncDeltaPackage["keyScheme"],
    keySalt: row.keySalt ?? null,
  };
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
  const now = new Date();
  const row = await prisma.syncSession.create({
    data: {
      id: randomUUID(),
      userId,
      status: "awaiting_peer",
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      masterDeviceId: deviceId,
      masterMarkerHash: markerHash,
      masterTableHashes: asJson(tableHashes),
      currentStep: 0,
      stepLog: [],
    },
  });
  return dbToSession(row);
}

export async function findAwaitingSession(
  userId: string,
  excludeDeviceId: string,
): Promise<SyncSession | null> {
  const row = await prisma.syncSession.findFirst({
    where: {
      userId,
      status: "awaiting_peer",
      masterDeviceId: { not: excludeDeviceId },
      expiresAt: { gt: new Date() },
    },
  });
  return row ? dbToSession(row) : null;
}

export async function joinSession(
  sessionId: string,
  slaveDeviceId: string,
  slaveMarkerHash: string | null,
  slaveTableHashes: TableHashes | null,
): Promise<SyncSession> {
  const session = await prisma.syncSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (session.status !== "awaiting_peer") {
    throw new Error(`Session ${sessionId} is not awaiting peer (status: ${session.status})`);
  }

  const syncMode = session.masterMarkerHash && slaveMarkerHash && session.masterMarkerHash === slaveMarkerHash
    ? "delta"
    : "full";

  const row = await prisma.syncSession.update({
    where: { id: sessionId },
    data: {
      slaveDeviceId,
      slaveMarkerHash,
      slaveTableHashes: asJson(slaveTableHashes),
      status: "negotiating",
      syncMode,
    },
  });
  return dbToSession(row);
}

// C1: Atomic find-and-join-or-create to prevent race conditions in session pairing
export async function findAndJoinOrCreate(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: TableHashes | null,
  peerPresent: boolean,
): Promise<{ session: SyncSession; role: "master" | "slave" } | { session: null; role: "no_peer" }> {
  // Use a transaction for atomicity
  return prisma.$transaction(async (tx) => {
    // Find existing awaiting session for this user (different device)
    const existing = await tx.syncSession.findFirst({
      where: {
        userId,
        status: "awaiting_peer",
        masterDeviceId: { not: deviceId },
        expiresAt: { gt: new Date() },
      },
    });

    if (existing) {
      const syncMode = existing.masterMarkerHash && markerHash && existing.masterMarkerHash === markerHash
        ? "delta"
        : "full";
      const ts = nowIso();
      const stepLog = (existing.stepLog as unknown as SyncStepLog[] ?? []);
      stepLog.push({
        step: 2,
        phase: "discovery",
        action: "slave_joined",
        deviceId,
        timestamp: ts,
        details: { slaveMarkerHash: markerHash, syncMode },
        status: "ok",
      });

      const row = await tx.syncSession.update({
        where: { id: existing.id },
        data: {
          slaveDeviceId: deviceId,
          slaveMarkerHash: markerHash,
          slaveTableHashes: asJson(tableHashes),
          status: "negotiating",
          currentStep: 2,
          syncMode,
          stepLog: asJson(stepLog),
        },
      });
      return { session: dbToSession(row), role: "slave" as const };
    }

    // No awaiting session to join. Only create a master session if a peer is
    // actually online — otherwise a solo device would park here for the whole TTL.
    if (!peerPresent) {
      return { session: null, role: "no_peer" as const };
    }

    // Create new session as master
    const ts = nowIso();
    const row = await tx.syncSession.create({
      data: {
        id: randomUUID(),
        userId,
        status: "awaiting_peer",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        masterDeviceId: deviceId,
        masterMarkerHash: markerHash,
        masterTableHashes: asJson(tableHashes),
        currentStep: 1,
        stepLog: asJson([
          {
            step: 1,
            phase: "discovery",
            action: "session_created",
            deviceId,
            timestamp: ts,
            details: { markerHash },
            status: "ok",
          },
        ]),
      },
    });
    return { session: dbToSession(row), role: "master" as const };
  });
}

export async function getAllSessions(): Promise<SyncSession[]> {
  const rows = await prisma.syncSession.findMany();
  return rows.map(dbToSession);
}

export async function getSession(sessionId: string): Promise<SyncSession | null> {
  const row = await prisma.syncSession.findUnique({ where: { id: sessionId } });
  return row ? dbToSession(row) : null;
}

export async function reportStep(
  sessionId: string,
  step: number,
  action: string,
  deviceId: string,
  details: Record<string, unknown>,
  status: "ok" | "error" | "warning",
): Promise<SyncSession> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.syncSession.findUniqueOrThrow({ where: { id: sessionId } });

    // C2: Ignore reports to terminal sessions
    if (TERMINAL_STATES.includes(session.status as SyncSessionStatus)) {
      return dbToSession(session);
    }

    // I6: Validate step range
    if (step < 1 || step > 13) {
      return dbToSession(session);
    }

    const stepLog = (session.stepLog as unknown as SyncStepLog[] ?? []);
    const logEntry: SyncStepLog = {
      step,
      phase: stepToPhase(step),
      action,
      deviceId,
      timestamp: nowIso(),
      details,
      status,
    };
    stepLog.push(logEntry);

    const newStep = Math.max(session.currentStep, step);
    let newStatus = session.status;
    let errorMessage = session.errorMessage;
    let completedAt = session.completedAt;

    // Handle error status
    if (status === "error") {
      newStatus = "failed";
      errorMessage = (details.error as string) ?? action;

      // Record failed session in history
      await tx.syncHistoryEntry.create({
        data: {
          id: randomUUID(),
          sessionId: session.id,
          masterDeviceId: session.masterDeviceId,
          slaveDeviceId: session.slaveDeviceId,
          syncMode: session.syncMode,
          resultMarkerHash: null,
          startedAt: session.createdAt,
          completedAt: new Date(),
          durationMs: Date.now() - session.createdAt.getTime(),
          status: "failed",
          errorMessage,
          stepCount: stepLog.length,
        },
      });
    }

    // Completion detection: both devices reported step 13
    if (step >= 13 && status === "ok") {
      const devicesAtStep13 = new Set(
        stepLog
          .filter((log) => log.step >= 13 && log.status === "ok")
          .map((log) => log.deviceId),
      );
      const masterReported = devicesAtStep13.has(session.masterDeviceId);
      const slaveReported = session.slaveDeviceId
        ? devicesAtStep13.has(session.slaveDeviceId)
        : false;

      if (masterReported && slaveReported) {
        newStatus = "completed";
        completedAt = new Date();

        await tx.syncHistoryEntry.create({
          data: {
            id: randomUUID(),
            sessionId: session.id,
            masterDeviceId: session.masterDeviceId,
            slaveDeviceId: session.slaveDeviceId,
            syncMode: session.syncMode,
            resultMarkerHash: session.resultMarkerHash,
            startedAt: session.createdAt,
            completedAt,
            durationMs: completedAt.getTime() - session.createdAt.getTime(),
            status: "completed",
            errorMessage: null,
            stepCount: stepLog.length,
          },
        });
      }
    }

    // Move to in_progress if still negotiating and step > 0
    if (newStatus === "negotiating" && step > 0 && status === "ok") {
      newStatus = "in_progress";
    }

    const row = await tx.syncSession.update({
      where: { id: sessionId },
      data: {
        stepLog: asJson(stepLog),
        currentStep: newStep,
        status: newStatus,
        errorMessage,
        completedAt,
      },
    });
    return dbToSession(row);
  });
}

export async function heartbeat(
  sessionId: string,
): Promise<SyncSession> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.syncSession.findUniqueOrThrow({ where: { id: sessionId } });

    // C2: Ignore heartbeats to terminal sessions
    if (TERMINAL_STATES.includes(session.status as SyncSessionStatus)) {
      return dbToSession(session);
    }

    // I3: Only extend TTL, never reduce it
    const newExpiry = new Date(Date.now() + HEARTBEAT_SLIDE_MS);
    const row = await tx.syncSession.update({
      where: { id: sessionId },
      data: {
        expiresAt: newExpiry > session.expiresAt ? newExpiry : session.expiresAt,
      },
    });
    return dbToSession(row);
  });
}

export async function cancelSession(
  sessionId: string,
  _deviceId: string,
  reason?: string,
): Promise<SyncSession> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.syncSession.findUniqueOrThrow({ where: { id: sessionId } });

    // C2: Ignore cancellation of terminal sessions
    if (TERMINAL_STATES.includes(session.status as SyncSessionStatus)) {
      return dbToSession(session);
    }

    const row = await tx.syncSession.update({
      where: { id: sessionId },
      data: {
        status: "cancelled",
        errorMessage: reason ?? session.errorMessage,
      },
    });
    return dbToSession(row);
  });
}

export async function expireSessions(): Promise<number> {
  const result = await prisma.syncSession.updateMany({
    where: {
      status: { in: ["awaiting_peer", "negotiating", "in_progress"] },
      expiresAt: { lte: new Date() },
    },
    data: { status: "expired" },
  });
  return result.count;
}

export async function cleanupOldSessions(maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.syncSession.deleteMany({
    where: {
      status: { in: ["completed", "failed", "expired", "cancelled"] },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

export async function clearAllSessions(): Promise<{ cleared: number }> {
  const result = await prisma.syncSession.deleteMany({});
  return { cleared: result.count };
}

// ---------------------------------------------------------------------------
// Atomic get + validate ownership + action
// ---------------------------------------------------------------------------

export async function withValidatedSession(
  sessionId: string,
  userId: string,
  deviceId: string,
  action: (session: SyncSession) => void,
): Promise<SyncSession> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.syncSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (row.userId !== userId) {
      throw new Error("Session does not belong to this user");
    }
    if (row.masterDeviceId !== deviceId && row.slaveDeviceId !== deviceId) {
      throw new Error("Device is not part of this session");
    }

    const session = dbToSession(row);
    action(session);

    // Write back the mutated session
    const updated = await tx.syncSession.update({
      where: { id: sessionId },
      data: {
        status: session.status,
        syncMode: session.syncMode,
        currentStep: session.currentStep,
        stepLog: asJson(session.stepLog),
        storageSessionPath: session.storageSessionPath,
        storageCredentials: asJson(session.storageCredentials),
        storageCredentialsSentAt: session.storageCredentialsSentAt ? new Date(session.storageCredentialsSentAt) : null,
        resultMarkerHash: session.resultMarkerHash,
        completedAt: session.completedAt ? new Date(session.completedAt) : null,
        errorMessage: session.errorMessage,
      },
    });
    return dbToSession(updated);
  });
}

// ---------------------------------------------------------------------------
export async function updateSessionSyncMode(
  sessionId: string,
  syncMode: string,
): Promise<void> {
  await prisma.syncSession.update({
    where: { id: sessionId },
    data: { syncMode },
  });
}

// Storage helpers
// ---------------------------------------------------------------------------

export async function updateSessionStorage(
  sessionId: string,
  storagePath: string,
  credentials: StorageCredentials,
): Promise<void> {
  await prisma.syncSession.update({
    where: { id: sessionId },
    data: {
      storageSessionPath: storagePath,
      storageCredentials: asJson(credentials),
      storageCredentialsSentAt: new Date(),
    },
  });
}

/** Get IDs of sessions in terminal state that have a storageSessionPath */
export async function getCompletedSessionIds(): Promise<string[]> {
  const rows = await prisma.syncSession.findMany({
    where: {
      status: { in: ["completed", "failed", "expired", "cancelled"] },
      storageSessionPath: { not: null },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Get IDs of sessions in active (non-terminal) state */
export async function getActiveSessionIds(): Promise<string[]> {
  const rows = await prisma.syncSession.findMany({
    where: {
      status: { notIn: ["completed", "failed", "expired", "cancelled"] },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Async delta packages
// ---------------------------------------------------------------------------

export async function createAsyncPackage(
  pkg: AsyncDeltaPackage,
): Promise<void> {
  await prisma.asyncDeltaPackage.create({
    data: {
      id: pkg.id,
      groupId: pkg.groupId,
      fromDeviceId: pkg.fromDeviceId,
      toGroupDevices: pkg.toGroupDevices,
      baseMarkerHash: pkg.baseMarkerHash,
      newMarkerHash: pkg.newMarkerHash,
      storagePath: pkg.storagePath,
      storageBackendId: pkg.storageBackendId,
      status: pkg.status,
      fileSizeBytes: pkg.fileSizeBytes,
      expiresAt: new Date(pkg.expiresAt),
      deliveredAt: pkg.deliveredAt ? new Date(pkg.deliveredAt) : null,
      deliveredToDeviceId: pkg.deliveredToDeviceId,
      keyScheme: pkg.keyScheme,
      keySalt: pkg.keySalt,
    },
  });
}

export async function getAsyncPackage(
  packageId: string,
): Promise<AsyncDeltaPackage | null> {
  const row = await prisma.asyncDeltaPackage.findUnique({ where: { id: packageId } });
  return row ? dbToAsyncPackage(row) : null;
}

export async function getAllAsyncPackages(): Promise<AsyncDeltaPackage[]> {
  const rows = await prisma.asyncDeltaPackage.findMany();
  return rows.map(dbToAsyncPackage);
}

export async function getPendingPackagesForGroup(
  groupId: string,
  excludeDeviceId: string,
): Promise<AsyncDeltaPackage[]> {
  const delivered = await prisma.asyncDeltaDelivery.findMany({
    where: { deviceId: excludeDeviceId },
    select: { packageId: true },
  });
  const deliveredIds = delivered.map((d) => d.packageId);
  const rows = await prisma.asyncDeltaPackage.findMany({
    where: {
      groupId,
      status: "pending",
      fromDeviceId: { not: excludeDeviceId },
      expiresAt: { gt: new Date() },
      id: { notIn: deliveredIds.length > 0 ? deliveredIds : ["__none__"] },
    },
  });
  return rows.map(dbToAsyncPackage);
}

export async function updateAsyncPackageStatus(
  packageId: string,
  status: AsyncDeltaPackage["status"],
  extra?: { deliveredToDeviceId?: string },
): Promise<AsyncDeltaPackage | null> {
  try {
    const row = await prisma.asyncDeltaPackage.update({
      where: { id: packageId },
      data: {
        status,
        deliveredAt: status === "delivered" ? new Date() : undefined,
        deliveredToDeviceId: status === "delivered" ? extra?.deliveredToDeviceId : undefined,
      },
    });
    return dbToAsyncPackage(row);
  } catch {
    return null;
  }
}

export async function expireAsyncPackages(): Promise<number> {
  const result = await prisma.asyncDeltaPackage.updateMany({
    where: {
      status: "pending",
      expiresAt: { lte: new Date() },
    },
    data: { status: "expired" },
  });
  return result.count;
}

export async function cleanupOldAsyncPackages(maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.asyncDeltaPackage.deleteMany({
    where: {
      status: { in: ["delivered", "rejected", "expired", "superseded"] },
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

/** Get expired/delivered/rejected async packages that still have storage paths */
export async function getCleanableAsyncPackageIds(): Promise<{ id: string; storagePath: string }[]> {
  const rows = await prisma.asyncDeltaPackage.findMany({
    where: {
      status: { in: ["delivered", "rejected", "expired"] },
      storagePath: { not: "" },
    },
    select: { id: true, storagePath: true },
  });
  return rows;
}

/** Zapisz potwierdzenie odbioru paczki przez konkretne urządzenie (idempotentnie). */
export async function recordAsyncDelivery(packageId: string, deviceId: string): Promise<void> {
  await prisma.asyncDeltaDelivery.upsert({
    where: { packageId_deviceId: { packageId, deviceId } },
    create: { packageId, deviceId },
    update: {},
  });
}

/** Lista deviceId, które potwierdziły odbiór danej paczki. */
export async function getAckedDeviceIds(packageId: string): Promise<string[]> {
  const rows = await prisma.asyncDeltaDelivery.findMany({
    where: { packageId },
    select: { deviceId: true },
  });
  return rows.map((r) => r.deviceId);
}

/** Aktywne urządzenia grupy (lastSeenAt w ostatnich 30 dniach). */
export async function getActiveDeviceIdsForGroup(groupId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.licenseDevice.findMany({
    where: { groupId, lastSeenAt: { gte: cutoff } },
    select: { deviceId: true },
  });
  return rows.map((r) => r.deviceId);
}

/** Paczki wysłane przez to urządzenie, które można już skasować z FTP (delivered/expired/superseded). */
export async function getSenderCleanablePackages(
  groupId: string,
  deviceId: string,
): Promise<{ packageId: string; storagePath: string }[]> {
  const rows = await prisma.asyncDeltaPackage.findMany({
    where: {
      groupId,
      fromDeviceId: deviceId,
      status: { in: ["delivered", "expired", "superseded"] },
      storagePath: { not: "" },
    },
    select: { id: true, storagePath: true },
  });
  return rows.map((r) => ({ packageId: r.id, storagePath: r.storagePath }));
}

/**
 * Oznacza wszystkie PENDING paczki danego urządzenia w grupie jako `superseded`.
 * Wołane przy nowym push: pełny eksport (build_full_export) zawiera całą historię,
 * więc poprzednie własne paczki są zbędne — stają się sender-cleanable od razu,
 * bez czekania na 72h TTL ani na ACK drugiej maszyny. Zwraca liczbę unieważnionych.
 */
export async function supersedeOwnPendingPackages(
  groupId: string,
  deviceId: string,
): Promise<number> {
  const result = await prisma.asyncDeltaPackage.updateMany({
    where: { groupId, fromDeviceId: deviceId, status: "pending" },
    data: { status: "superseded" },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export async function getSyncHistory(
  limit = 50,
  offset = 0,
): Promise<{ entries: SyncHistoryEntry[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.syncHistoryEntry.findMany({
      orderBy: { completedAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.syncHistoryEntry.count(),
  ]);
  return { entries: rows.map(dbToHistory), total };
}

export async function getSyncHistoryEntry(
  entryId: string,
): Promise<SyncHistoryEntry | null> {
  const row = await prisma.syncHistoryEntry.findUnique({ where: { id: entryId } });
  return row ? dbToHistory(row) : null;
}

export async function getSyncHistoryForUser(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ entries: SyncHistoryEntry[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.syncHistoryEntry.findMany({
      where: { session: { userId } },
      orderBy: { completedAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.syncHistoryEntry.count({
      where: { session: { userId } },
    }),
  ]);
  return { entries: rows.map(dbToHistory), total };
}
