// ---------------------------------------------------------------------------
// Storage backend types
// ---------------------------------------------------------------------------

export type StorageBackendType = "sftp" | "ftp" | "aws-s3";

interface StorageBackendBase {
  id: string;
  type: StorageBackendType;
  name: string;
  basePath: string;
  maxFileSizeMb: number;
  sessionTtlMinutes: number;
  createdAt: string;
}

export interface SftpStorageBackend extends StorageBackendBase {
  type: "sftp";
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface FtpStorageBackend extends StorageBackendBase {
  type: "ftp";
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

export interface S3StorageBackend extends StorageBackendBase {
  type: "aws-s3";
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  usePresignedUrls: boolean;
}

export type StorageBackendConfig = SftpStorageBackend | FtpStorageBackend | S3StorageBackend;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LicensePlan = "free" | "starter" | "pro" | "enterprise";

export type LicenseStatus =
  | "active"
  | "trial"
  | "expired"
  | "suspended"
  | "revoked";

export interface License {
  id: string;
  licenseKey: string;
  groupId: string;
  plan: LicensePlan;
  status: LicenseStatus;
  createdAt: string;
  expiresAt: string | null;
  maxDevices: number;
  activeDevices: string[];
}

export interface ClientGroup {
  id: string;
  name: string;
  ownerId: string;
  licenseId: string;
  storageBackendId: string;
  fixedMasterDeviceId: string | null;
  syncPriority: Record<string, number>;
  maxSyncFrequencyHours: number | null;
  maxDatabaseSizeMb: number | null;
}

export interface DeviceRegistration {
  deviceId: string;
  groupId: string;
  licenseId: string;
  deviceName: string;
  apiToken: string;
  registeredAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastMarkerHash: string | null;
  isFixedMaster: boolean;
}

// ---------------------------------------------------------------------------
// Store file
// ---------------------------------------------------------------------------

export interface LicenseStoreFile {
  version: 1;
  licenses: Record<string, License>;
  groups: Record<string, ClientGroup>;
  devices: Record<string, DeviceRegistration>;
  storageBackends: Record<string, StorageBackendConfig>;
}

// ---------------------------------------------------------------------------
// Plan defaults
// ---------------------------------------------------------------------------

export const PLAN_DEFAULTS: Record<
  LicensePlan,
  { maxDevices: number; maxDatabaseSizeMb: number; maxSyncFrequencyHours: number }
> = {
  free: { maxDevices: 2, maxDatabaseSizeMb: 50, maxSyncFrequencyHours: 24 },
  starter: { maxDevices: 5, maxDatabaseSizeMb: 200, maxSyncFrequencyHours: 8 },
  pro: { maxDevices: 20, maxDatabaseSizeMb: 1024, maxSyncFrequencyHours: 1 },
  enterprise: { maxDevices: 9999, maxDatabaseSizeMb: 10240, maxSyncFrequencyHours: 0.25 },
};

// ---------------------------------------------------------------------------
// Admin API request/response bodies
// ---------------------------------------------------------------------------

export interface AdminCreateLicenseBody {
  plan: LicensePlan;
  groupId?: string;
  groupName?: string;
  ownerId?: string;
  maxDevices?: number;
  expiresAt?: string | null;
}

export interface AdminUpdateLicenseBody {
  plan?: LicensePlan;
  status?: LicenseStatus;
  maxDevices?: number;
  expiresAt?: string | null;
}

export interface AdminCreateGroupBody {
  name: string;
  ownerId: string;
  licenseId: string;
  storageBackendId?: string;
  fixedMasterDeviceId?: string | null;
  maxSyncFrequencyHours?: number | null;
  maxDatabaseSizeMb?: number | null;
}

export interface AdminUpdateGroupBody {
  name?: string;
  storageBackendId?: string;
  fixedMasterDeviceId?: string | null;
  maxSyncFrequencyHours?: number | null;
  maxDatabaseSizeMb?: number | null;
}

export interface AdminLicenseResponse {
  ok: true;
  license: License;
}

export interface AdminLicenseListResponse {
  ok: true;
  licenses: License[];
  total: number;
}

export interface AdminGroupResponse {
  ok: true;
  group: ClientGroup;
}

export interface AdminGroupListResponse {
  ok: true;
  groups: ClientGroup[];
  total: number;
}

export interface AdminDeviceListResponse {
  ok: true;
  devices: DeviceRegistration[];
  total: number;
}

export interface AdminDeleteResponse {
  ok: true;
  deleted: boolean;
}

// ---------------------------------------------------------------------------
// Storage backend admin API
// ---------------------------------------------------------------------------

export interface AdminCreateStorageBackendBody {
  type: StorageBackendType;
  name: string;
  basePath: string;
  maxFileSizeMb?: number;
  sessionTtlMinutes?: number;
  // SFTP / FTP fields
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  secure?: boolean;
  // S3 fields
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  usePresignedUrls?: boolean;
}

export interface AdminUpdateStorageBackendBody {
  name?: string;
  basePath?: string;
  maxFileSizeMb?: number;
  sessionTtlMinutes?: number;
  // SFTP fields
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  // S3 fields
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  usePresignedUrls?: boolean;
}

export interface AdminStorageBackendResponse {
  ok: true;
  storageBackend: StorageBackendConfig;
}

export interface AdminStorageBackendListResponse {
  ok: true;
  storageBackends: StorageBackendConfig[];
  total: number;
}

export interface AdminStorageBackendTestResponse {
  ok: true;
  reachable: boolean;
  error: string | null;
}
