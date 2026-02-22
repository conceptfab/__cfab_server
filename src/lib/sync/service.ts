import { randomUUID } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { jsonByteSize, sha256Json } from "@/lib/sync/hash";
import { getSyncRepository, type SyncRepository } from "@/lib/sync/repository";
import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncStatusRequest,
  SyncStatusResponse,
  UserSyncRecord,
} from "@/lib/sync/contracts";

function nowIso(): string {
  return new Date().toISOString();
}

function updateDeviceHeartbeat(
  user: UserSyncRecord,
  deviceId: string,
  clientRevision: number | null,
  clientHash: string | null,
): void {
  user.devices[deviceId] = {
    lastSeenAt: nowIso(),
    lastClientRevision: clientRevision,
    lastClientHash: clientHash,
  };
}

export async function getSyncStatus(
  req: SyncStatusRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncStatusResponse> {
  return repository.withUserState(req.userId, (user) => {
    updateDeviceHeartbeat(user, req.deviceId, req.clientRevision, req.clientHash);

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
  });
}

export async function pushSnapshot(
  req: SyncPushRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncPushResponse> {
  const env = getEnv();
  const payloadSha256 = sha256Json(req.archive);
  const archiveSizeBytes = jsonByteSize(req.archive);

  return repository.withUserState(req.userId, (user) => {
    const current = user.latestSnapshot;
    updateDeviceHeartbeat(
      user,
      req.deviceId,
      req.knownServerRevision ?? current?.revision ?? null,
      payloadSha256,
    );

    if (current && current.payloadSha256 === payloadSha256) {
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

    const receivedAt = nowIso();
    const nextRevision = (current?.revision ?? 0) + 1;

    user.snapshots.push({
      id: randomUUID(),
      revision: nextRevision,
      payloadSha256,
      receivedAt,
      sourceDeviceId: req.deviceId,
      sizeBytes: archiveSizeBytes,
      archive: req.archive,
    });

    const retention = env.syncSnapshotRetentionCount;
    if (retention > 0 && user.snapshots.length > retention) {
      user.snapshots = user.snapshots.slice(-retention);
    }
    user.latestSnapshot = user.snapshots[user.snapshots.length - 1] ?? null;

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
  });
}

export async function pullSnapshot(
  req: SyncPullRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncPullResponse> {
  return repository.withUserState(req.userId, (user) => {
    updateDeviceHeartbeat(user, req.deviceId, req.clientRevision ?? null, null);

    const latest = user.latestSnapshot;
    if (!latest) {
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
  });
}

