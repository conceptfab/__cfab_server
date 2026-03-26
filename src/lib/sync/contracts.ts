export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface TableHashes {
  projects: string;
  applications: string;
  sessions: string;
  manual_sessions: string;
}

export interface DeltaData {
  projects: any[];
  applications: any[];
  sessions: any[];
  manual_sessions: any[];
  tombstones: {
    table_name: string;
    record_id: string;
    record_uuid: string;
    deleted_at: string;
    sync_key: string;
  }[];
}

export interface SyncPushBody {
  userId?: string | null;
  deviceId: string;
  knownServerRevision: number | null;
  archive: JsonValue;
}

export interface SyncDeltaPushBody {
  userId?: string | null;
  deviceId: string;
  tableHashes: TableHashes;
  baseRevision: number;
  delta: DeltaData;
}

export interface SyncStatusBody {
  userId?: string | null;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
  tableHashes?: TableHashes;
}

export interface SyncPullBody {
  userId?: string | null;
  deviceId: string;
  clientRevision: number | null;
}

export interface SyncAckBody {
  userId?: string | null;
  deviceId: string;
  revision: number;
  payloadSha256: string;
}

export interface SyncStatusRequest {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
  tableHashes?: TableHashes;
}

export interface SyncPushRequest {
  userId: string;
  deviceId: string;
  knownServerRevision: number | null;
  archive: JsonValue;
}

export interface SyncDeltaPushRequest {
  userId: string;
  deviceId: string;
  tableHashes: TableHashes;
  baseRevision: number;
  delta: DeltaData;
}

export interface SyncPullRequest {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
}

export interface SyncAckRequest {
  userId: string;
  deviceId: string;
  revision: number;
  payloadSha256: string;
}

export interface StoredSnapshot {
  id: string;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  sourceDeviceId: string;
  sizeBytes: number;
  archive: JsonValue;
  tableHashes?: TableHashes | null;
}

export interface DeviceSyncInfo {
  lastSeenAt: string;
  lastClientRevision: number | null;
  lastClientHash: string | null;
  lastAckRevision: number | null;
  lastAckHash: string | null;
  lastAckAt: string | null;
}

export interface UserSyncRecord {
  latestSnapshot: StoredSnapshot | null;
  snapshots: StoredSnapshot[];
  devices: Record<string, DeviceSyncInfo>;
}

export interface SyncStoreFile {
  version: 2;
  users: Record<string, UserSyncRecord>;
}

export interface SyncStatusResponse {
  ok: true;
  userId: string;
  deviceId: string;
  serverOnline: true;
  serverRevision: number;
  serverHash: string | null;
  serverUpdatedAt: string | null;
  hasServerData: boolean;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
  dirtyTables?: string[];
}

export interface SyncDeltaPushResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}

export interface SyncPushResponse {
  ok: true;
  accepted: boolean;
  noOp: boolean;
  userId: string;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  reason: string;
}

export interface SyncPullResponse {
  ok: true;
  hasUpdate: boolean;
  userId: string;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: JsonValue;
  reason: string;
}

export interface SyncAckResponse {
  ok: true;
  accepted: boolean;
  userId: string;
  deviceId: string;
  revision: number;
  payloadSha256: string;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}
