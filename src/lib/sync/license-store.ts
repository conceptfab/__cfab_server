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
  return { version: 1, licenses: {}, groups: {}, devices: {} };
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
      return parsed as LicenseStoreFile;
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
// Device operations
// ---------------------------------------------------------------------------

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
