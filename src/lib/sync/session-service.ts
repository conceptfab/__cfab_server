import type {
  SessionCancelBody,
  SessionCancelResponse,
  SessionCreateBody,
  SessionCreateResponse,
  SessionHeartbeatBody,
  SessionHeartbeatResponse,
  SessionReportBody,
  SessionReportResponse,
  SessionStatusResponse,
  SyncSession,
} from "@/lib/sync/session-contracts";
import type { SftpConnectionInfo } from "./storage-encryption";
import { resolveRole } from "@/lib/sync/session-roles";
import {
  cancelSession,
  findAndJoinOrCreate,
  getSession,
  heartbeat,
  reportStep,
  updateSessionStorage,
} from "@/lib/sync/session-store";
import { createSessionDir } from "./sftp-manager";
import { encryptCredentialsWithFileKey } from "./storage-encryption";
import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";

// ---------------------------------------------------------------------------
// Next-action resolution
// ---------------------------------------------------------------------------

function determineNextAction(
  session: SyncSession,
  role: "master" | "slave",
): string | null {
  const { status, currentStep, syncMode } = session;

  if (status === "completed" || status === "failed" || status === "expired" || status === "cancelled") {
    return null;
  }

  if (status === "awaiting_peer") {
    return role === "master" ? "wait_for_peer" : "join_session";
  }

  if (status === "negotiating") {
    if (!syncMode) return "determine_sync_mode";
    return role === "master" ? "prepare_storage" : "wait_for_storage";
  }

  // in_progress
  if (currentStep < 5) {
    return role === "master" ? "upload_data" : "wait_for_upload";
  }
  if (currentStep < 8) {
    return role === "master" ? "merge_data" : "wait_for_merge";
  }
  if (currentStep < 11) {
    return role === "slave" ? "download_result" : "wait_for_download";
  }
  return "confirm_completion";
}

// ---------------------------------------------------------------------------
// Ownership validation helper
// ---------------------------------------------------------------------------

function validateOwnership(
  session: SyncSession,
  userId: string,
  deviceId: string,
): void {
  if (session.userId !== userId) {
    throw new Error("Session does not belong to this user");
  }
  if (
    session.masterDeviceId !== deviceId &&
    session.slaveDeviceId !== deviceId
  ) {
    throw new Error("Device is not part of this session");
  }
}

// ---------------------------------------------------------------------------
// Service handlers
// ---------------------------------------------------------------------------

export async function handleSessionCreate(
  userId: string,
  body: SessionCreateBody,
): Promise<SessionCreateResponse> {
  // C1: Atomic find-and-join-or-create to prevent race condition in session pairing
  const { session, role } = await findAndJoinOrCreate(
    userId,
    body.deviceId,
    body.markerHash,
    body.tableHashes,
  );

  if (role === "slave") {
    // Provision SFTP storage when session transitions to "negotiating"
    try {
      const env = getEnv();
      if (env.sftpHost && env.sftpUser && env.sftpPassword && env.syncEncryptionKey) {
        const sessionPath = await createSessionDir(session.id);

        const connection: SftpConnectionInfo = {
          host: env.sftpHost,
          port: env.sftpPort,
          protocol: "sftp",
          username: env.sftpUser,
          password: env.sftpPassword,
          uploadPath: `${sessionPath}/slave-upload/`,
          downloadPath: `${sessionPath}/master-merged/`,
        };

        const encrypted = encryptCredentialsWithFileKey(connection, session.id);

        await updateSessionStorage(session.id, sessionPath, {
          encrypted,
        });
      }
    } catch (error) {
      log("warn", "session-service.sftp-provision-failed", {
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ok: true,
      sessionId: session.id,
      role: "slave",
      status: session.status,
      peerDeviceId: session.masterDeviceId,
      peerMarkerHash: session.masterMarkerHash,
      syncMode: session.syncMode,
    };
  }

  return {
    ok: true,
    sessionId: session.id,
    role: "master",
    status: session.status,
    peerDeviceId: null,
    peerMarkerHash: null,
    syncMode: null,
  };
}

export async function handleSessionStatus(
  userId: string,
  sessionId: string,
  deviceId: string,
): Promise<SessionStatusResponse> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.userId !== userId) {
    throw new Error("Session does not belong to this user");
  }
  // C3: Validate that the requesting device is a participant in this session
  if (session.masterDeviceId !== deviceId && session.slaveDeviceId !== deviceId) {
    throw new Error("Device not participant in this session");
  }

  const role = resolveRole(session.masterDeviceId, deviceId);
  const peerDeviceId =
    role === "master" ? session.slaveDeviceId : session.masterDeviceId;
  const peerReady = session.slaveDeviceId !== null;
  const nextAction = determineNextAction(session, role);

  return {
    ok: true,
    sessionId: session.id,
    status: session.status,
    myRole: role,
    currentStep: session.currentStep,
    syncMode: session.syncMode,
    peerDeviceId,
    peerReady,
    nextAction,
    expiresAt: session.expiresAt,
    storageCredentials: session.storageCredentials ?? null,
  };
}

export async function handleSessionReport(
  userId: string,
  sessionId: string,
  body: SessionReportBody,
): Promise<SessionReportResponse> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  validateOwnership(session, userId, body.deviceId);

  const updated = await reportStep(
    sessionId,
    body.step,
    body.action,
    body.deviceId,
    body.details,
    body.status,
  );

  return {
    ok: true,
    acknowledged: true,
    currentStep: updated.currentStep,
    sessionStatus: updated.status,
  };
}

export async function handleSessionHeartbeat(
  userId: string,
  sessionId: string,
  body: SessionHeartbeatBody,
): Promise<SessionHeartbeatResponse> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  validateOwnership(session, userId, body.deviceId);

  const updated = await heartbeat(sessionId, body.deviceId);

  return {
    ok: true,
    sessionStatus: updated.status,
    expiresAt: updated.expiresAt,
  };
}

export async function handleSessionCancel(
  userId: string,
  sessionId: string,
  body: SessionCancelBody,
): Promise<SessionCancelResponse> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  validateOwnership(session, userId, body.deviceId);

  const updated = await cancelSession(sessionId, body.deviceId, body.reason);

  return {
    ok: true,
    cancelled: updated.status === "cancelled",
    sessionId: updated.id,
  };
}
