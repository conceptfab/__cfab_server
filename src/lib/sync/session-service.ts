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
  findAndJoinOrCreate,
  stepToPhase,
  updateSessionStorage,
  updateSessionSyncMode,
  withValidatedSession,
} from "@/lib/sync/session-store";
import { createStorageAdapter, getGlobalStorageAdapter } from "./sftp-manager";
import type { StorageAdapter } from "./sftp-manager";
import { encryptCredentialsWithFileKey } from "./storage-encryption";
import { getEnv } from "@/lib/config/env";
import { getStorageBackend, getAllGroups, getAllLicenses, touchDeviceLastSeen, getDevice, getDevicesForLicense, getDevicesForUser } from "./license-store";
import { isPeerPresent } from "@/lib/sync/peer-presence";
import type { ClientGroup, DeviceRegistration, License } from "./license-contracts";
import { validateLicenseForSync } from "./license-middleware";
import { log } from "@/lib/observability/logger";

interface UserLicenseContext {
  license: License;
  group: ClientGroup;
  device: DeviceRegistration | null;
}

async function resolveLicenseContext(userId: string): Promise<UserLicenseContext | null> {
  const groups = await getAllGroups();
  // NOTE: Currently assumes 1 user = 1 group. If multi-group support is added,
  // this needs to accept a groupId parameter or return all matching groups.
  const group = groups.find((g) => g.ownerId === userId);
  if (!group) return null;

  const licenses = await getAllLicenses();
  const license = licenses.find((l) => l.id === group.licenseId);
  if (!license) return null;

  // Device may not be registered yet (first sync)
  const device: DeviceRegistration | null = null; // Looked up from store if needed
  return { license, group, device };
}

async function resolveStorageBackendForUser(userId: string): Promise<string | null> {
  const groups = await getAllGroups();
  const group = groups.find((g) => g.ownerId === userId);
  if (!group || !group.storageBackendId || group.storageBackendId === "default") {
    return null;
  }
  return group.storageBackendId;
}

// ---------------------------------------------------------------------------
// Next-action resolution
// ---------------------------------------------------------------------------

/** Step boundaries for sync phases */
const PHASE_SETUP_END = 5;
const PHASE_TRANSFER_END = 8;
const PHASE_FINALIZE_END = 11;

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
  if (currentStep < PHASE_SETUP_END) {
    return role === "master" ? "upload_data" : "wait_for_upload";
  }
  if (currentStep < PHASE_TRANSFER_END) {
    return role === "master" ? "merge_data" : "wait_for_merge";
  }
  if (currentStep < PHASE_FINALIZE_END) {
    return role === "slave" ? "download_result" : "wait_for_download";
  }
  return "confirm_completion";
}

// ---------------------------------------------------------------------------
// Service handlers
// ---------------------------------------------------------------------------

export async function handleSessionCreate(
  userId: string,
  body: SessionCreateBody,
): Promise<SessionCreateResponse> {
  // License enforcement: if user has a license context, validate it
  const licenseCtx = await resolveLicenseContext(userId);
  if (licenseCtx) {
    const { license, group } = licenseCtx;
    // Build a minimal device registration for validation
    const deviceReg: DeviceRegistration = licenseCtx.device ?? {
      deviceId: body.deviceId,
      groupId: group.id,
      licenseId: license.id,
      deviceName: body.deviceId,
      apiToken: "",
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastSyncAt: null,
      lastMarkerHash: null,
      isFixedMaster: group.fixedMasterDeviceId === body.deviceId,
    };
    validateLicenseForSync(license, group, deviceReg, body.deviceId);
  }

  // Peer-presence gate: register this device as seen, then check whether any
  // OTHER device in the license group is online (last 5 min). Mirrors the
  // presence pattern in direct-sync.ts. Prevents a solo device from parking a
  // master session that waits the full TTL for a peer that will never join.
  // Note: touchDeviceLastSeen / isPeerPresent read the FS-backed license store,
  // not the Prisma transaction below — a small TOCTOU window exists, but the
  // 5-minute freshness window makes it inconsequential (worst case: one skipped cycle).
  await touchDeviceLastSeen(body.deviceId).catch(() => {});
  const requestingDevice = await getDevice(body.deviceId);
  const peerDevices = requestingDevice
    ? await getDevicesForLicense(requestingDevice.licenseId)
    : await getDevicesForUser(userId);
  const peerPresent = isPeerPresent(peerDevices, body.deviceId, Date.now());

  // C1: Atomic find-and-join-or-create to prevent race condition in session pairing
  const result = await findAndJoinOrCreate(
    userId,
    body.deviceId,
    body.markerHash,
    body.tableHashes,
    peerPresent,
  );

  if (result.role === "no_peer") {
    log("info", "session-service.no-peer", { userId, deviceId: body.deviceId });
    return {
      ok: true,
      sessionId: "",
      // role is "master" by convention (no session was created); the client must
      // branch on `status === "no_peer"` first — NOT on role — to skip the sync.
      role: "master",
      status: "no_peer",
      peerDeviceId: null,
      peerMarkerHash: null,
      syncMode: null,
    };
  }

  const { session, role } = result;

  // Force full sync override (requested by client via tray menu)
  if (body.forceFullSync && session.syncMode) {
    session.syncMode = "full";
    await updateSessionSyncMode(session.id, "full");
  }

  if (role === "slave") {
    // Provision storage when session transitions to "negotiating"
    try {
      const env = getEnv();
      if (env.syncEncryptionKey) {
        // Resolve storage adapter: group backend → global fallback
        let adapter: StorageAdapter | null = null;
        let backendId = "global";

        const groupBackendId = await resolveStorageBackendForUser(userId);
        if (groupBackendId) {
          const backendConfig = await getStorageBackend(groupBackendId);
          if (backendConfig) {
            adapter = createStorageAdapter(backendConfig);
            backendId = backendConfig.id;
          }
        }

        if (!adapter) {
          adapter = getGlobalStorageAdapter();
        }

        if (adapter) {
          const sessionPath = await adapter.createSessionDir(session.id);
          const connInfo = adapter.getConnectionInfo(session.id);

          const connection: SftpConnectionInfo = {
            host: connInfo.host,
            port: connInfo.port,
            protocol: "sftp",
            username: connInfo.username,
            password: connInfo.password,
            uploadPath: connInfo.uploadPath,
            downloadPath: connInfo.downloadPath,
          };

          // Legacy ścieżka sesyjna: zostaje przy globalnym SYNC_ENCRYPTION_KEY
          // (gwarantowany przez guard powyżej). Async-delta (demon) używa klucza grupy.
          const encrypted = encryptCredentialsWithFileKey(
            connection,
            session.id,
            env.syncEncryptionKey,
          );

          await updateSessionStorage(session.id, sessionPath, {
            encrypted,
          });

          log("info", "session-service.storage-provisioned", {
            sessionId: session.id,
            backendId,
          });
        }
      }
    } catch (error) {
      log("warn", "session-service.storage-provision-failed", {
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
  // C2: Atomic validate-ownership + read status in a single mutex lock
  const session = await withValidatedSession(sessionId, userId, deviceId, () => {
    // no mutations needed — just validate and return
  });

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
  // C2: Atomic validate-ownership + report-step in a single mutex lock
  const updated = await withValidatedSession(sessionId, userId, body.deviceId, (session) => {
    const TERMINAL = ["completed", "failed", "expired", "cancelled"];
    if (TERMINAL.includes(session.status)) return;
    if (body.step < 1 || body.step > 13) return;

    session.stepLog.push({
      step: body.step,
      phase: stepToPhase(body.step),
      action: body.action,
      deviceId: body.deviceId,
      timestamp: new Date().toISOString(),
      details: body.details,
      status: body.status,
    });
    if (body.step > session.currentStep) session.currentStep = body.step;
    session.updatedAt = new Date().toISOString();

    if (body.status === "error") {
      session.status = "failed";
      session.errorMessage = (body.details.error as string) ?? body.action;
    }
    // Marker mismatch soft-check: compare master step 10 and slave step 12 markers
    if (body.step === 12 && body.status === "ok") {
      const masterStep10 = session.stepLog.find(
        (l) => l.step === 10 && l.deviceId === session.masterDeviceId && l.status === "ok",
      );
      const slaveMarker = (body.details.marker as string) ?? null;
      const masterMarker = (masterStep10?.details.marker as string) ?? null;
      if (slaveMarker && masterMarker && slaveMarker !== masterMarker) {
        session.stepLog.push({
          step: 12,
          phase: "verify",
          action: "marker_mismatch_warning",
          deviceId: "server",
          timestamp: new Date().toISOString(),
          details: { masterMarker, slaveMarker },
          status: "warning",
        });
      }
    }

    if (body.step >= 13 && body.status === "ok") {
      const devicesAtStep13 = new Set(
        session.stepLog.filter((l) => l.step >= 13 && l.status === "ok").map((l) => l.deviceId),
      );
      if (devicesAtStep13.has(session.masterDeviceId) && session.slaveDeviceId && devicesAtStep13.has(session.slaveDeviceId)) {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
      }
    }
    if (session.status === "negotiating" && body.step > 0 && body.status === "ok") {
      session.status = "in_progress";
    }
  });

  // Fire-and-forget: clean up session directory on storage when completed
  if (updated.status === "completed" && updated.storageSessionPath) {
    const sessionPath = updated.storageSessionPath;
    const sessionId = updated.id;
    const masterDeviceId = updated.masterDeviceId;
    void (async () => {
      try {
        const { getDevice, getGroup } = await import("./license-store");
        const device = await getDevice(masterDeviceId);
        if (!device) return;
        const group = await getGroup(device.groupId);
        if (!group?.storageBackendId) return;
        const backend = await getStorageBackend(group.storageBackendId);
        if (!backend) return;
        const adapter = createStorageAdapter(backend);
        await adapter.deleteSessionDir(sessionId);
        log("info", "session.cleanup.immediate", {
          sessionId,
          storagePath: sessionPath,
        });
      } catch (err) {
        log("warn", "session.cleanup.immediate.failed", {
          sessionId,
          error: String(err),
        });
      }
    })();
  }

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
  // C2: Atomic validate-ownership + heartbeat in a single mutex lock
  const updated = await withValidatedSession(sessionId, userId, body.deviceId, (session) => {
    const TERMINAL = ["completed", "failed", "expired", "cancelled"];
    if (TERMINAL.includes(session.status)) return;

    const HEARTBEAT_SLIDE_MS = 2 * 60 * 1000;
    const newExpiry = new Date(Date.now() + HEARTBEAT_SLIDE_MS).toISOString();
    if (new Date(newExpiry).getTime() > new Date(session.expiresAt).getTime()) {
      session.expiresAt = newExpiry;
    }
    session.updatedAt = new Date().toISOString();
  });

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
  // C2: Atomic validate-ownership + cancel in a single mutex lock
  const updated = await withValidatedSession(sessionId, userId, body.deviceId, (session) => {
    const TERMINAL = ["completed", "failed", "expired", "cancelled"];
    if (TERMINAL.includes(session.status)) return;

    session.status = "cancelled";
    session.updatedAt = new Date().toISOString();
    if (body.reason) {
      session.errorMessage = body.reason;
    }
  });

  return {
    ok: true,
    cancelled: updated.status === "cancelled",
    sessionId: updated.id,
  };
}
