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
import { resolveRole } from "@/lib/sync/session-roles";
import {
  cancelSession,
  createSession,
  findAwaitingSession,
  getSession,
  heartbeat,
  joinSession,
  reportStep,
} from "@/lib/sync/session-store";

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
  // Check for existing awaiting session for this user from a different device
  const existing = await findAwaitingSession(userId, body.deviceId);

  if (existing) {
    // Join as slave
    const joined = await joinSession(
      existing.id,
      body.deviceId,
      body.markerHash,
      body.tableHashes,
    );
    return {
      ok: true,
      sessionId: joined.id,
      role: "slave",
      status: joined.status,
      peerDeviceId: joined.masterDeviceId,
      peerMarkerHash: joined.masterMarkerHash,
      syncMode: joined.syncMode,
    };
  }

  // Create new session as master
  const session = await createSession(
    userId,
    body.deviceId,
    body.markerHash,
    body.tableHashes,
  );
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
