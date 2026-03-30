import type { TableHashes } from "./contracts";

export type SyncSessionStatus =
  | "awaiting_peer"
  | "negotiating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

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

  syncMode: "full" | "delta" | null;
  masterMarkerHash: string | null;
  slaveMarkerHash: string | null;
  masterTableHashes: TableHashes | null;
  slaveTableHashes: TableHashes | null;

  currentStep: number;
  stepLog: SyncStepLog[];

  storageSessionPath: string | null;
  storageCredentialsSentAt: string | null;

  resultMarkerHash: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// --- Request/Response types ---

export interface SessionCreateBody {
  deviceId: string;
  markerHash: string | null;
  tableHashes: TableHashes | null;
}

export interface SessionCreateResponse {
  ok: true;
  sessionId: string;
  role: "master" | "slave";
  status: SyncSessionStatus;
  peerDeviceId: string | null;
  peerMarkerHash: string | null;
  syncMode: "full" | "delta" | null;
}

export interface SessionStatusResponse {
  ok: true;
  sessionId: string;
  status: SyncSessionStatus;
  myRole: "master" | "slave";
  currentStep: number;
  syncMode: "full" | "delta" | null;
  peerDeviceId: string | null;
  peerReady: boolean;
  nextAction: string | null;
  expiresAt: string;
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
  currentStep: number;
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

export interface SessionStoreFile {
  version: 1;
  sessions: Record<string, SyncSession>;
}
