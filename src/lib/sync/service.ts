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
  SyncDeltaPushRequest,
  SyncDeltaPushResponse,
  DeltaData,
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

// ---------------------------------------------------------------------------
// Merge helpers — upsert rows by primary key, newer updated_at wins
// ---------------------------------------------------------------------------

function upsertRows(
  existing: any[],
  incoming: any[],
  pk: string = "id",
): any[] {
  const map = new Map<string | number, any>();
  for (const row of existing) {
    map.set(row[pk], row);
  }
  for (const row of incoming) {
    const key = row[pk];
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
    } else if (row.updated_at && prev.updated_at && row.updated_at > prev.updated_at) {
      map.set(key, row);
    } else if (!prev.updated_at) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function mergeArchiveData(
  base: any,
  incoming: any,
): any {
  const baseData = base?.data ?? base ?? {};
  const incData = incoming?.data ?? incoming ?? {};

  const merged = JSON.parse(JSON.stringify(base));
  const target = merged.data ?? merged;

  target.projects = upsertRows(
    Array.isArray(baseData.projects) ? baseData.projects : [],
    Array.isArray(incData.projects) ? incData.projects : [],
  );
  target.applications = upsertRows(
    Array.isArray(baseData.applications) ? baseData.applications : [],
    Array.isArray(incData.applications) ? incData.applications : [],
  );
  target.sessions = upsertRows(
    Array.isArray(baseData.sessions) ? baseData.sessions : [],
    Array.isArray(incData.sessions) ? incData.sessions : [],
  );
  target.manual_sessions = upsertRows(
    Array.isArray(baseData.manual_sessions) ? baseData.manual_sessions : [],
    Array.isArray(incData.manual_sessions) ? incData.manual_sessions : [],
    "uuid",
  );

  // daily_files: merge keys, incoming wins on conflict
  if (incData.daily_files && typeof incData.daily_files === "object") {
    if (!target.daily_files || typeof target.daily_files !== "object") {
      target.daily_files = {};
    }
    Object.assign(target.daily_files, incData.daily_files);
  }

  // Apply tombstones from incoming: remove deleted rows
  const tombstones = Array.isArray(incData.tombstones) ? incData.tombstones : [];
  for (const ts of tombstones) {
    const tableName = ts.table_name as string;
    if (Array.isArray(target[tableName])) {
      const recordId = ts.record_id ?? ts.record_uuid;
      const pk = ts.record_uuid ? "uuid" : "id";
      target[tableName] = target[tableName].filter(
        (r: any) => r[pk] !== recordId,
      );
    }
  }

  // Update metadata
  if (merged.exported_at && incoming.exported_at && incoming.exported_at > merged.exported_at) {
    merged.exported_at = incoming.exported_at;
  }
  if (merged.metadata && target.sessions) {
    merged.metadata.total_sessions = target.sessions.length;
  }

  return merged;
}

function pruneDeliveredArchives(user: UserSyncRecord): void {
  if (user.snapshots.length === 0) return;

  // Never prune the latest snapshot — it's needed as base for delta pushes
  const latestRevision = user.latestSnapshot?.revision ?? -1;

  for (const snapshot of user.snapshots) {
    if (snapshot.archive === null) continue;
    if (snapshot.revision === latestRevision) continue;

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

    let dirtyTables: string[] | undefined;
    if (req.tableHashes && latest.tableHashes) {
      dirtyTables = [];
      if (req.tableHashes.projects !== latest.tableHashes.projects) dirtyTables.push("projects");
      if (req.tableHashes.applications !== latest.tableHashes.applications) dirtyTables.push("applications");
      if (req.tableHashes.sessions !== latest.tableHashes.sessions) dirtyTables.push("sessions");
      if (req.tableHashes.manual_sessions !== latest.tableHashes.manual_sessions) dirtyTables.push("manual_sessions");
      
      if (dirtyTables.length > 0 && !shouldPush) {
        shouldPush = true;
        reason = "table_hashes_mismatch_delta_required";
      } else if (dirtyTables.length === 0 && !shouldPush && !shouldPull) {
        reason = "table_hashes_match_in_sync";
      }
    } else if (req.tableHashes && !latest.tableHashes) {
       dirtyTables = ["projects", "applications", "sessions", "manual_sessions"];
       if (!shouldPush) {
           shouldPush = true;
           reason = "missing_server_table_hashes_delta_required";
       }
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
      dirtyTables,
    };
  });
}

export async function pushSnapshot(
  req: SyncPushRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncPushResponse> {
  const env = getEnv();
  const incomingSha256 = sha256Json(req.archive);

  return repository.withUserState(req.userId, (user) => {
    const current = user.latestSnapshot;
    updateDeviceHeartbeat(
      user,
      req.deviceId,
      req.knownServerRevision ?? current?.revision ?? null,
      incomingSha256,
    );

    if (current && current.payloadSha256 === incomingSha256) {
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

    // Merge incoming data with existing snapshot instead of replacing
    const mergedArchive =
      current?.archive && typeof current.archive === "object"
        ? mergeArchiveData(current.archive, req.archive)
        : req.archive;

    const mergedSha256 = sha256Json(mergedArchive);
    const mergedSizeBytes = jsonByteSize(mergedArchive);

    const receivedAt = nowIso();
    const nextRevision = (current?.revision ?? 0) + 1;

    user.snapshots.push({
      id: randomUUID(),
      revision: nextRevision,
      payloadSha256: mergedSha256,
      receivedAt,
      sourceDeviceId: req.deviceId,
      sizeBytes: mergedSizeBytes,
      archive: mergedArchive,
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
      payloadSha256: mergedSha256,
      receivedAt,
      reason: "snapshot_merged",
    };
  });
}

export async function pushDelta(
  req: SyncDeltaPushRequest,
  repository: SyncRepository = getSyncRepository(),
): Promise<SyncDeltaPushResponse> {
  const env = getEnv();

  return repository.withUserState(req.userId, (user) => {
    const current = user.latestSnapshot;
    
    // Fallback: jeśli serwer nie ma danych lub wersja bazy się nie zgadza
    if (!current || !current.archive || typeof current.archive !== 'object') {
       return {
         ok: true,
         accepted: false,
         revision: current?.revision ?? 0,
         serverTableHashes: req.tableHashes,
         reason: "no_base_snapshot",
       };
    }

    if (current.revision !== req.baseRevision) {
        return {
          ok: true,
          accepted: false,
          revision: current.revision,
          serverTableHashes: req.tableHashes,
          reason: "revision_mismatch",
        };
    }

    // Shallow-copy only the arrays that will be mutated (avoids full deep-clone)
    const baseArchive = current.archive as any;
    const baseData = baseArchive.data ?? baseArchive;
    const archive = { ...baseArchive };
    const data = { ...baseData };
    if (baseArchive.data) archive.data = data;

    // upsert helper — uses Map for O(1) lookups instead of findIndex O(N)
    const applyUpserts = (tableName: keyof DeltaData, pk: string = 'id') => {
       const rows = req.delta[tableName as keyof typeof req.delta];
       if (!Array.isArray(rows) || rows.length === 0) return;

       const existing = Array.isArray(data[tableName]) ? data[tableName] as any[] : [];
       const table = [...existing];
       const indexMap = new Map<unknown, number>();
       for (let i = 0; i < table.length; i++) {
           indexMap.set(table[i][pk], i);
       }

       for (const inc of rows as any[]) {
           const idx = indexMap.get(inc[pk]);
           if (idx !== undefined) {
               table[idx] = inc;
           } else {
               indexMap.set(inc[pk], table.length);
               table.push(inc);
           }
       }
       data[tableName] = table;
    };

    applyUpserts('projects');
    applyUpserts('applications');
    applyUpserts('sessions');
    applyUpserts('manual_sessions');

    // apply tombstones — resolve pk the same way mergeArchiveData does
    if (Array.isArray(req.delta.tombstones)) {
        for (const ts of req.delta.tombstones) {
            const table = data[ts.table_name];
            if (Array.isArray(table)) {
                const recordId = ts.record_uuid ?? ts.record_id;
                const pk = ts.record_uuid ? "uuid" : "id";
                data[ts.table_name] = table.filter((r: any) => r[pk] !== recordId);
            }
        }
    }

    const payloadSha256 = sha256Json(archive);
    const archiveSizeBytes = jsonByteSize(archive);

    updateDeviceHeartbeat(
      user,
      req.deviceId,
      current.revision,
      payloadSha256,
    );

    const receivedAt = nowIso();
    const nextRevision = current.revision + 1;

    user.snapshots.push({
      id: randomUUID(),
      revision: nextRevision,
      payloadSha256,
      receivedAt,
      sourceDeviceId: req.deviceId,
      sizeBytes: archiveSizeBytes,
      archive: archive,
      tableHashes: req.tableHashes,
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
      revision: nextRevision,
      serverTableHashes: req.tableHashes,
      reason: "delta_applied",
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
