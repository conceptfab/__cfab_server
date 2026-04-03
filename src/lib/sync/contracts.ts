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
    record_id: number | string | null;
    record_uuid: string | null;
    deleted_at: string;
    sync_key: string;
  }[];
}

export interface DeviceSyncInfo {
  lastSeenAt: string;
  lastClientRevision: number | null;
  lastClientHash: string | null;
  lastAckRevision: number | null;
  lastAckHash: string | null;
  lastAckAt: string | null;
}

export interface StoredSnapshot {
  id: string;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  sourceDeviceId: string;
  sizeBytes: number;
  archive: Record<string, unknown> | null;
  tableHashes?: TableHashes | null;
}

export interface UserSyncRecord {
  latestSnapshot: StoredSnapshot | null;
  snapshots: StoredSnapshot[];
  devices: Record<string, DeviceSyncInfo>;
}

export interface SyncStoreFile {
  version: number;
  users: Record<string, UserSyncRecord>;
}

export interface SyncStatusRequest {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
  tableHashes?: TableHashes | null;
}

export interface SyncStatusResponse {
  ok: boolean;
  userId: string;
  deviceId: string;
  serverOnline: boolean;
  serverRevision: number;
  serverHash: string | null;
  serverUpdatedAt: string | null;
  hasServerData: boolean;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
  dirtyTables?: string[];
}

export interface SyncPushRequest {
  userId: string;
  deviceId: string;
  archive: Record<string, unknown>;
  knownServerRevision?: number | null;
}

export interface SyncPushResponse {
  ok: boolean;
  accepted: boolean;
  noOp: boolean;
  userId: string;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  reason: string;
}

export interface SyncPullRequest {
  userId: string;
  deviceId: string;
  clientRevision?: number | null;
}

export interface SyncPullResponse {
  ok: boolean;
  hasUpdate: boolean;
  userId: string;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: Record<string, unknown>;
  reason: string;
}

export interface SyncAckRequest {
  userId: string;
  deviceId: string;
  revision: number;
  payloadSha256: string;
}

export interface SyncAckResponse {
  ok: boolean;
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

export interface SyncDeltaPushRequest {
  userId: string;
  deviceId: string;
  baseRevision: number;
  tableHashes: TableHashes;
  delta: DeltaData;
}

export interface SyncDeltaPushResponse {
  ok: boolean;
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}
