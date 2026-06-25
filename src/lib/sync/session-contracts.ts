import type { TableHashes } from "@/lib/sync/contracts";
import type { EncryptedCredentials } from "./storage-encryption";

// ---------------------------------------------------------------------------
// Storage credentials (encrypted SFTP creds for clients)
// ---------------------------------------------------------------------------

export interface StorageCredentials {
  encrypted: EncryptedCredentials;
  // fileEncryptionKey is now included INSIDE the encrypted payload (C1 security fix)
}

// ---------------------------------------------------------------------------
// Session status & step log
// ---------------------------------------------------------------------------

export type SyncSessionStatus =
  | "awaiting_peer"
  // "no_peer" is a session/create RESPONSE status only — it is never persisted as a SyncSession row.
  | "no_peer"
  | "negotiating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export type SyncMode = "full" | "delta";

export interface SyncStepLog {
  step: number;
  phase: string;
  action: string;
  deviceId: string;
  timestamp: string;
  details: Record<string, unknown>;
  status: "ok" | "error" | "warning";
}

export interface SyncSession {
  id: string;
  userId: string;
  status: SyncSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  masterDeviceId: string;
  slaveDeviceId: string | null;
  syncMode: SyncMode | null;
  masterMarkerHash: string | null;
  slaveMarkerHash: string | null;
  masterTableHashes: TableHashes | null;
  slaveTableHashes: TableHashes | null;
  currentStep: number;
  stepLog: SyncStepLog[];
  storageSessionPath: string | null;
  storageCredentials: StorageCredentials | null;
  storageCredentialsSentAt: string | null;
  resultMarkerHash: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export interface SyncHistoryEntry {
  id: string;
  sessionId: string;
  masterDeviceId: string;
  slaveDeviceId: string | null;
  syncMode: SyncMode | null;
  resultMarkerHash: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "completed" | "failed";
  errorMessage: string | null;
  stepCount: number;
}

// ---------------------------------------------------------------------------
// Async delta packages (store-and-forward)
// ---------------------------------------------------------------------------

export type AsyncPackageStatus =
  | "pending"       // uploaded, waiting for peer to pull
  | "delivered"     // peer downloaded + acked
  | "rejected"      // peer rejected (base marker mismatch)
  | "superseded"    // nadawca wypchnął nowszą pełną bazę → ta paczka jest zbędna
  | "expired";      // TTL exceeded

export interface AsyncDeltaPackage {
  id: string;
  groupId: string;
  fromDeviceId: string;
  toGroupDevices: boolean;           // true = any device in group can pull
  baseMarkerHash: string | null;
  newMarkerHash: string;
  storagePath: string;               // path on storage backend
  storageBackendId: string | null;   // null = global env backend
  status: AsyncPackageStatus;
  fileSizeBytes: number;
  createdAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  deliveredToDeviceId: string | null;
}

export interface AsyncPushBody {
  deviceId: string;
  groupId: string;
  baseMarkerHash: string | null;
  newMarkerHash: string;
  fileSizeBytes: number;
}

export interface AsyncPushResponse {
  ok: true;
  packageId: string;
  storagePath: string;
  storageCredentials: StorageCredentials | null;
  expiresAt: string;
}

export interface AsyncPendingResponse {
  ok: true;
  packages: AsyncDeltaPackage[];
}

export interface AsyncAckBody {
  deviceId: string;
  packageId: string;
}

export interface AsyncAckResponse {
  ok: true;
  acknowledged: boolean;
}

export interface AsyncRejectBody {
  deviceId: string;
  packageId: string;
  reason?: string;
}

export interface AsyncRejectResponse {
  ok: true;
  rejected: boolean;
}

// ---------------------------------------------------------------------------
// Store file
// ---------------------------------------------------------------------------

export interface SessionStoreFile {
  version: 1;
  sessions: Record<string, SyncSession>;
  asyncPackages?: Record<string, AsyncDeltaPackage>;
  syncHistory?: SyncHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Request / response bodies
// ---------------------------------------------------------------------------

export interface SessionCreateBody {
  deviceId: string;
  markerHash: string | null;
  tableHashes: TableHashes | null;
  forceFullSync?: boolean;
}

export interface SessionCreateResponse {
  ok: true;
  sessionId: string;
  role: "master" | "slave";
  status: SyncSessionStatus;
  peerDeviceId: string | null;
  peerMarkerHash: string | null;
  syncMode: SyncMode | null;
}

export interface SessionStatusResponse {
  ok: true;
  sessionId: string;
  status: SyncSessionStatus;
  myRole: "master" | "slave";
  currentStep: number;
  syncMode: SyncMode | null;
  peerDeviceId: string | null;
  peerReady: boolean;
  nextAction: string | null;
  expiresAt: string;
  storageCredentials: StorageCredentials | null;
}

export interface SessionReportBody {
  step: number;
  action: string;
  deviceId: string;
  details: Record<string, unknown>;
  status: "ok" | "error" | "warning";
}

export interface SessionReportResponse {
  ok: true;
  acknowledged: boolean;
  currentStep: number;
  sessionStatus: SyncSessionStatus;
}

export interface SessionHeartbeatBody {
  deviceId: string;
  currentStep?: number;
  transferProgress?: {
    bytesTransferred: number;
    bytesTotal: number;
    percentComplete: number;
  };
}

export interface SessionHeartbeatResponse {
  ok: true;
  sessionStatus: SyncSessionStatus;
  expiresAt: string;
}

export interface SessionCancelBody {
  deviceId: string;
  reason?: string;
}

export interface SessionCancelResponse {
  ok: true;
  cancelled: boolean;
  sessionId: string;
}
