import { randomUUID } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { jsonByteSize, sha256Json } from "@/lib/sync/hash";
import { getSyncRepository, type SyncRepository } from "@/lib/sync/repository";
import type {
  SyncAckRequest,
  SyncAckResponse,
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
  const previous = user.devices[deviceId];
  user.devices[deviceId] = {
    lastAckRevision: previous?.lastAckRevision ?? null,
    lastAckHash: previous?.lastAckHash ?? null,
    lastAckAt: previous?.lastAckAt ?? null,
    lastSeenAt: nowIso(),
    lastClientRevision: clientRevision,
    lastClientHash: clientHash,
  };
}

function markDeviceAck(
  user: UserSyncRecord,
  deviceId: string,
  revision: number,
  payloadSha256: string,
): void {
  const seenAt = nowIso();
  user.devices[deviceId] = {
    lastSeenAt: seenAt,
    lastClientRevision: revision,
    lastClientHash: payloadSha256,
    lastAckRevision: revision,
    lastAckHash: payloadSha256,
    lastAckAt: seenAt,
  };
}

function deviceAckedSnapshot(device: UserSyncRecord["devices"][string], revision: number, hash: string): boolean {
  if (device.lastAckHash && device.lastAckHash === hash) {
    return true;
  }
  if (typeof device.lastAckRevision === "number" && device.lastAckRevision >= revision) {
    return true;
  }
  return false;
}

function pruneDeliveredArchives(user: UserSyncRecord): void {
  if (user.snapshots.length === 0) return;

  for (const snapshot of user.snapshots) {
    if (snapshot.archive === null) continue;

    const targetDevices = Object.entries(user.devices).filter(
      ([deviceId]) => deviceId !== snapshot.sourceDeviceId,
    );

    if (targetDevices.length === 0) {
      continue;
    }

    const deliveredToAllTargets = targetDevices.every(([, device]) =>
      deviceAckedSnapshot(device, snapshot.revision, snapshot.payloadSha256),
    );

    if (deliveredToAllTargets) {
      snapshot.archive = null;
    }
  }
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
    const latestPayloadAvailable = latest.archive !== null;

    let shouldPull = false;
    let shouldPush = false;
    let reason = "in_sync";

    if (hasServerNewer && !sameHash && !latestPayloadAvailable) {
      reason = "server_snapshot_pruned";
    } else if (hasServerNewer && !sameHash) {
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
    pruneDeliveredArchives(user);

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

    if (latest.archive === null) {
      return {
        ok: true,
        hasUpdate: false,
        userId: req.userId,
        revision: latest.revision,
        payloadSha256: latest.payloadSha256,
        receivedAt: latest.receivedAt,
        reason: "server_snapshot_pruned",
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

export async function ackPulledSnapshot(
  req: SyncAckRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncAckResponse> {
  return repository.withUserState(req.userId, (user) => {
    const latest = user.latestSnapshot;
    const snapshot =
      user.snapshots.find((entry) => entry.revision === req.revision) ?? null;

    if (!snapshot) {
      const previous = user.devices[req.deviceId];
      updateDeviceHeartbeat(
        user,
        req.deviceId,
        previous?.lastClientRevision ?? null,
        previous?.lastClientHash ?? null,
      );

      return {
        ok: true,
        accepted: false,
        userId: req.userId,
        deviceId: req.deviceId,
        revision: req.revision,
        payloadSha256: req.payloadSha256,
        serverRevision: latest?.revision ?? 0,
        serverHash: latest?.payloadSha256 ?? null,
        isLatest: false,
        reason: "unknown_revision",
      };
    }

    if (snapshot.payloadSha256 !== req.payloadSha256) {
      const previous = user.devices[req.deviceId];
      updateDeviceHeartbeat(
        user,
        req.deviceId,
        previous?.lastClientRevision ?? null,
        previous?.lastClientHash ?? null,
      );

      return {
        ok: true,
        accepted: false,
        userId: req.userId,
        deviceId: req.deviceId,
        revision: req.revision,
        payloadSha256: req.payloadSha256,
        serverRevision: latest?.revision ?? 0,
        serverHash: latest?.payloadSha256 ?? null,
        isLatest: false,
        reason: "hash_mismatch_for_revision",
      };
    }

    markDeviceAck(user, req.deviceId, snapshot.revision, snapshot.payloadSha256);
    pruneDeliveredArchives(user);

    const isLatest =
      latest !== null &&
      snapshot.revision === latest.revision &&
      snapshot.payloadSha256 === latest.payloadSha256;

    return {
      ok: true,
      accepted: true,
      userId: req.userId,
      deviceId: req.deviceId,
      revision: snapshot.revision,
      payloadSha256: snapshot.payloadSha256,
      serverRevision: latest?.revision ?? 0,
      serverHash: latest?.payloadSha256 ?? null,
      isLatest,
      reason: isLatest ? "acknowledged_latest_snapshot" : "acknowledged_stale_snapshot",
    };
  });
}
