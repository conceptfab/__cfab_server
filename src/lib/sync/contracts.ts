export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SyncStatusBody {
  userId?: string | null;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
}

export interface SyncPushBody {
  userId?: string | null;
  deviceId: string;
  knownServerRevision: number | null;
  archive: JsonValue;
}

export interface SyncPullBody {
  userId?: string | null;
  deviceId: string;
  clientRevision: number | null;
}

export interface SyncStatusRequest {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
}

export interface SyncPushRequest {
  userId: string;
  deviceId: string;
  knownServerRevision: number | null;
  archive: JsonValue;
}

export interface SyncPullRequest {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
}

export interface StoredSnapshot {
  id: string;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  sourceDeviceId: string;
  sizeBytes: number;
  archive: JsonValue;
}

export interface DeviceSyncInfo {
  lastSeenAt: string;
  lastClientRevision: number | null;
  lastClientHash: string | null;
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

