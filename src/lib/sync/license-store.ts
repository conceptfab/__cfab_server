import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ClientGroup,
  DeviceRegistration,
  License,
  LicensePlan,
  LicenseStatus,
  LicenseStoreFile,
  StorageBackendConfig,
  StorageBackendType,
} from "./license-contracts";
import { PLAN_DEFAULTS } from "./license-contracts";
import { generateLicenseKey } from "./license-keygen";

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "license-store.json");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): LicenseStoreFile {
  return { version: 1, licenses: {}, groups: {}, devices: {}, storageBackends: {} };
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<LicenseStoreFile> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "licenses" in parsed
    ) {
      const store = parsed as LicenseStoreFile;
      // Backfill storageBackends for stores created before Phase 2
      if (!store.storageBackends) {
        (store as any).storageBackends = {};
      }
      return store;
    }
    return emptyStore();
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyStore();
    }
    throw error;
  }
}

async function writeStore(store: LicenseStoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

let mutex: Promise<void> = Promise.resolve();

async function withMutex<T>(work: () => Promise<T>): Promise<T> {
  const previous = mutex;
  let release: () => void = () => {};
  mutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// License CRUD
// ---------------------------------------------------------------------------

export async function createLicense(
  plan: LicensePlan,
  groupId: string,
  maxDevices?: number,
  expiresAt?: string | null,
): Promise<License> {
  return withMutex(async () => {
    const store = await readStore();
    const license: License = {
      id: randomUUID(),
      licenseKey: generateLicenseKey(plan),
      groupId,
      plan,
      status: "active",
      createdAt: nowIso(),
      expiresAt: expiresAt ?? null,
      maxDevices: maxDevices ?? PLAN_DEFAULTS[plan].maxDevices,
      activeDevices: [],
    };
    store.licenses[license.id] = license;
    await writeStore(store);
    return license;
  });
}

export async function getLicense(id: string): Promise<License | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.licenses[id] ?? null;
  });
}

export async function getAllLicenses(): Promise<License[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.licenses);
  });
}

export async function updateLicense(
  id: string,
  updates: {
    plan?: LicensePlan;
    status?: LicenseStatus;
    maxDevices?: number;
    expiresAt?: string | null;
  },
): Promise<License | null> {
  return withMutex(async () => {
    const store = await readStore();
    const license = store.licenses[id];
    if (!license) return null;

    if (updates.plan !== undefined) license.plan = updates.plan;
    if (updates.status !== undefined) license.status = updates.status;
    if (updates.maxDevices !== undefined) license.maxDevices = updates.maxDevices;
    if (updates.expiresAt !== undefined) license.expiresAt = updates.expiresAt;

    await writeStore(store);
    return license;
  });
}

export async function deleteLicense(id: string): Promise<boolean> {
  return withMutex(async () => {
    const store = await readStore();
    if (!store.licenses[id]) return false;
    delete store.licenses[id];

    // Remove associated devices
    for (const [deviceId, device] of Object.entries(store.devices)) {
      if (device.licenseId === id) {
        delete store.devices[deviceId];
      }
    }

    await writeStore(store);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export async function createGroup(
  name: string,
  ownerId: string,
  licenseId: string,
  storageBackendId?: string,
  fixedMasterDeviceId?: string | null,
  maxSyncFrequencyHours?: number | null,
  maxDatabaseSizeMb?: number | null,
): Promise<ClientGroup> {
  return withMutex(async () => {
    const store = await readStore();
    const group: ClientGroup = {
      id: randomUUID(),
      name,
      ownerId,
      licenseId,
      storageBackendId: storageBackendId ?? "default",
      fixedMasterDeviceId: fixedMasterDeviceId ?? null,
      syncPriority: {},
      maxSyncFrequencyHours: maxSyncFrequencyHours ?? null,
      maxDatabaseSizeMb: maxDatabaseSizeMb ?? null,
    };
    store.groups[group.id] = group;
    await writeStore(store);
    return group;
  });
}

export async function getGroup(id: string): Promise<ClientGroup | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.groups[id] ?? null;
  });
}

export async function getAllGroups(): Promise<ClientGroup[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.groups);
  });
}

export async function updateGroup(
  id: string,
  updates: {
    name?: string;
    fixedMasterDeviceId?: string | null;
    maxSyncFrequencyHours?: number | null;
    maxDatabaseSizeMb?: number | null;
  },
): Promise<ClientGroup | null> {
  return withMutex(async () => {
    const store = await readStore();
    const group = store.groups[id];
    if (!group) return null;

    if (updates.name !== undefined) group.name = updates.name;
    if (updates.fixedMasterDeviceId !== undefined) group.fixedMasterDeviceId = updates.fixedMasterDeviceId;
    if (updates.maxSyncFrequencyHours !== undefined) group.maxSyncFrequencyHours = updates.maxSyncFrequencyHours;
    if (updates.maxDatabaseSizeMb !== undefined) group.maxDatabaseSizeMb = updates.maxDatabaseSizeMb;

    await writeStore(store);
    return group;
  });
}

// ---------------------------------------------------------------------------
// License lookup by key
// ---------------------------------------------------------------------------

export async function findLicenseByKey(licenseKey: string): Promise<License | null> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.licenses).find((l) => l.licenseKey === licenseKey) ?? null;
  });
}

export async function getGroupForLicense(licenseId: string): Promise<ClientGroup | null> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.groups).find((g) => g.licenseId === licenseId) ?? null;
  });
}

// ---------------------------------------------------------------------------
// Device operations
// ---------------------------------------------------------------------------

export async function registerDevice(
  licenseId: string,
  groupId: string,
  deviceId: string,
  deviceName: string,
): Promise<DeviceRegistration> {
  return withMutex(async () => {
    const store = await readStore();
    const license = store.licenses[licenseId];
    if (!license) throw new Error(`License not found: ${licenseId}`);

    // Check if device already registered
    const existing = store.devices[deviceId];
    if (existing && existing.licenseId === licenseId) {
      existing.lastSeenAt = nowIso();
      await writeStore(store);
      return existing;
    }

    // Check device limit
    if (license.activeDevices.length >= license.maxDevices) {
      throw new Error(`Device limit reached (${license.maxDevices})`);
    }

    const group = store.groups[groupId];
    const device: DeviceRegistration = {
      deviceId,
      groupId,
      licenseId,
      deviceName,
      registeredAt: nowIso(),
      lastSeenAt: nowIso(),
      lastSyncAt: null,
      lastMarkerHash: null,
      isFixedMaster: group?.fixedMasterDeviceId === deviceId,
    };
    store.devices[deviceId] = device;
    license.activeDevices.push(deviceId);
    await writeStore(store);
    return device;
  });
}

/**
 * Update lastSeenAt for a known device (called on every authenticated sync request).
 * Fire-and-forget — failures are silently ignored so sync flow is not blocked.
 */
export async function touchDeviceLastSeen(deviceId: string): Promise<void> {
  return withMutex(async () => {
    const store = await readStore();
    const device = store.devices[deviceId];
    if (!device) return;
    device.lastSeenAt = nowIso();
    await writeStore(store);
  });
}

/**
 * Update lastSyncAt and optionally lastMarkerHash after a completed sync.
 */
export async function updateDeviceLastSync(
  deviceId: string,
  markerHash?: string | null,
): Promise<void> {
  return withMutex(async () => {
    const store = await readStore();
    const device = store.devices[deviceId];
    if (!device) return;
    device.lastSyncAt = nowIso();
    device.lastSeenAt = nowIso();
    if (markerHash !== undefined) {
      device.lastMarkerHash = markerHash;
    }
    await writeStore(store);
  });
}

export async function getDevice(deviceId: string): Promise<DeviceRegistration | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.devices[deviceId] ?? null;
  });
}

export async function getDevicesForLicense(licenseId: string): Promise<DeviceRegistration[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.devices).filter((d) => d.licenseId === licenseId);
  });
}

export async function deregisterDevice(
  licenseId: string,
  deviceId: string,
): Promise<boolean> {
  return withMutex(async () => {
    const store = await readStore();
    const device = store.devices[deviceId];
    if (!device || device.licenseId !== licenseId) return false;

    delete store.devices[deviceId];

    // Remove from license activeDevices
    const license = store.licenses[licenseId];
    if (license) {
      license.activeDevices = license.activeDevices.filter((d) => d !== deviceId);
    }

    await writeStore(store);
    return true;
  });
}

export async function getDevicesForUser(userId: string): Promise<DeviceRegistration[]> {
  return withMutex(async () => {
    const store = await readStore();
    // Find groups owned by this user
    const userGroupIds = new Set(
      Object.values(store.groups)
        .filter((g) => g.ownerId === userId)
        .map((g) => g.id),
    );
    return Object.values(store.devices).filter((d) => userGroupIds.has(d.groupId));
  });
}

// ---------------------------------------------------------------------------
// Storage backend CRUD
// ---------------------------------------------------------------------------

export async function createStorageBackend(
  config: Omit<StorageBackendConfig, "id" | "createdAt">,
): Promise<StorageBackendConfig> {
  return withMutex(async () => {
    const store = await readStore();
    const id = randomUUID();
    const backend = {
      ...config,
      id,
      createdAt: nowIso(),
    } as StorageBackendConfig;
    store.storageBackends[id] = backend;
    await writeStore(store);
    return backend;
  });
}

export async function getStorageBackend(id: string): Promise<StorageBackendConfig | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.storageBackends[id] ?? null;
  });
}

export async function getAllStorageBackends(): Promise<StorageBackendConfig[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.storageBackends);
  });
}

export async function updateStorageBackend(
  id: string,
  updates: Partial<Omit<StorageBackendConfig, "id" | "createdAt" | "type">>,
): Promise<StorageBackendConfig | null> {
  return withMutex(async () => {
    const store = await readStore();
    const backend = store.storageBackends[id];
    if (!backend) return null;

    Object.assign(backend, updates);
    await writeStore(store);
    return backend;
  });
}

export async function deleteStorageBackend(id: string): Promise<{ deleted: boolean; reason?: string }> {
  return withMutex(async () => {
    const store = await readStore();
    if (!store.storageBackends[id]) return { deleted: false, reason: "not_found" };

    // Check if any group references this backend
    const assignedGroups = Object.values(store.groups).filter(
      (g) => g.storageBackendId === id,
    );
    if (assignedGroups.length > 0) {
      return {
        deleted: false,
        reason: `Backend is assigned to ${assignedGroups.length} group(s): ${assignedGroups.map((g) => g.name).join(", ")}`,
      };
    }

    delete store.storageBackends[id];
    await writeStore(store);
    return { deleted: true };
  });
}
