import { randomBytes, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import type {
  License as PrismaLicense,
  Group as PrismaGroup,
  LicenseDevice as PrismaLicenseDevice,
  StorageBackend as PrismaStorageBackend,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { log } from "@/lib/observability/logger";
import type {
  ClientGroup,
  DeviceRegistration,
  License,
  LicensePlan,
  LicenseStatus,
  StorageBackendConfig,
  StorageBackendType,
} from "./license-contracts";
import { PLAN_DEFAULTS } from "./license-contracts";
import { generateLicenseKey } from "./license-keygen";
import { computeGroupV2Readiness, type GroupV2Status } from "./migration";

// ---------------------------------------------------------------------------
// State store backed by Postgres (Prisma). All entities previously lived in
// data/license-store.json; cross-references (groupId/licenseId/storageBackendId)
// remain loose string IDs with integrity enforced here, as before.
// ---------------------------------------------------------------------------

function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Domain ↔ Prisma mappers
// ---------------------------------------------------------------------------

function mapLicense(row: PrismaLicense, activeDevices: string[]): License {
  return {
    id: row.id,
    licenseKey: row.licenseKey,
    groupId: row.groupId,
    plan: row.plan as LicensePlan,
    status: row.status as LicenseStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    maxDevices: row.maxDevices,
    activeDevices,
  };
}

function mapGroup(row: PrismaGroup): ClientGroup {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    licenseId: row.licenseId,
    storageBackendId: row.storageBackendId,
    fixedMasterDeviceId: row.fixedMasterDeviceId ?? null,
    syncPriority: (row.syncPriority as Record<string, number>) ?? {},
    maxSyncFrequencyHours: row.maxSyncFrequencyHours ?? null,
    maxDatabaseSizeMb: row.maxDatabaseSizeMb ?? null,
  };
}

function mapDevice(row: PrismaLicenseDevice): DeviceRegistration {
  return {
    deviceId: row.deviceId,
    groupId: row.groupId,
    licenseId: row.licenseId,
    deviceName: row.deviceName,
    apiToken: row.apiToken,
    registeredAt: row.registeredAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastMarkerHash: row.lastMarkerHash ?? null,
    isFixedMaster: row.isFixedMaster,
    supportsV2: row.supportsV2 ?? false,
  };
}

function mapBackend(row: PrismaStorageBackend): StorageBackendConfig {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    type: row.type as StorageBackendType,
    name: row.name,
    basePath: row.basePath,
    maxFileSizeMb: row.maxFileSizeMb,
    sessionTtlMinutes: row.sessionTtlMinutes,
    createdAt: row.createdAt.toISOString(),
    ...config,
  } as StorageBackendConfig;
}

async function activeDeviceIds(licenseId: string): Promise<string[]> {
  const devices = await prisma.licenseDevice.findMany({
    where: { licenseId },
    select: { deviceId: true },
  });
  return devices.map((d) => d.deviceId);
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
  const row = await prisma.license.create({
    data: {
      id: randomUUID(),
      licenseKey: generateLicenseKey(plan),
      groupId,
      plan,
      status: "active",
      maxDevices: maxDevices ?? PLAN_DEFAULTS[plan].maxDevices,
      createdAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });
  return mapLicense(row, []);
}

export async function getLicense(id: string): Promise<License | null> {
  const row = await prisma.license.findUnique({ where: { id } });
  if (!row) return null;
  return mapLicense(row, await activeDeviceIds(id));
}

export async function getAllLicenses(): Promise<License[]> {
  const [licenses, devices] = await Promise.all([
    prisma.license.findMany(),
    prisma.licenseDevice.findMany({ select: { licenseId: true, deviceId: true } }),
  ]);
  const byLicense = new Map<string, string[]>();
  for (const d of devices) {
    const list = byLicense.get(d.licenseId) ?? [];
    list.push(d.deviceId);
    byLicense.set(d.licenseId, list);
  }
  return licenses.map((l) => mapLicense(l, byLicense.get(l.id) ?? []));
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
  const exists = await prisma.license.findUnique({ where: { id } });
  if (!exists) return null;

  const data: Prisma.LicenseUpdateInput = {};
  if (updates.plan !== undefined) data.plan = updates.plan;
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.maxDevices !== undefined) data.maxDevices = updates.maxDevices;
  if (updates.expiresAt !== undefined) {
    data.expiresAt = updates.expiresAt ? new Date(updates.expiresAt) : null;
  }

  const row = await prisma.license.update({ where: { id }, data });
  return mapLicense(row, await activeDeviceIds(id));
}

export async function deleteLicense(id: string): Promise<boolean> {
  const existing = await prisma.license.findUnique({ where: { id } });
  if (!existing) return false;

  // Remove associated devices, then the license.
  await prisma.$transaction([
    prisma.licenseDevice.deleteMany({ where: { licenseId: id } }),
    prisma.license.delete({ where: { id } }),
  ]);
  return true;
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
  const row = await prisma.group.create({
    data: {
      id: randomUUID(),
      name,
      ownerId,
      licenseId,
      storageBackendId: storageBackendId ?? "default",
      fixedMasterDeviceId: fixedMasterDeviceId ?? null,
      syncPriority: {},
      maxSyncFrequencyHours: maxSyncFrequencyHours ?? null,
      maxDatabaseSizeMb: maxDatabaseSizeMb ?? null,
    },
  });
  return mapGroup(row);
}

export async function getGroup(id: string): Promise<ClientGroup | null> {
  const row = await prisma.group.findUnique({ where: { id } });
  return row ? mapGroup(row) : null;
}

export async function getAllGroups(): Promise<ClientGroup[]> {
  const rows = await prisma.group.findMany();
  return rows.map(mapGroup);
}

export async function updateGroup(
  id: string,
  updates: {
    name?: string;
    ownerId?: string;
    licenseId?: string;
    storageBackendId?: string;
    fixedMasterDeviceId?: string | null;
    maxSyncFrequencyHours?: number | null;
    maxDatabaseSizeMb?: number | null;
  },
): Promise<ClientGroup | null> {
  const exists = await prisma.group.findUnique({ where: { id } });
  if (!exists) return null;

  const data: Prisma.GroupUpdateInput = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.ownerId !== undefined) data.ownerId = updates.ownerId;
  if (updates.licenseId !== undefined) data.licenseId = updates.licenseId;
  if (updates.storageBackendId !== undefined) data.storageBackendId = updates.storageBackendId;
  if (updates.fixedMasterDeviceId !== undefined) data.fixedMasterDeviceId = updates.fixedMasterDeviceId;
  if (updates.maxSyncFrequencyHours !== undefined) data.maxSyncFrequencyHours = updates.maxSyncFrequencyHours;
  if (updates.maxDatabaseSizeMb !== undefined) data.maxDatabaseSizeMb = updates.maxDatabaseSizeMb;

  const row = await prisma.group.update({ where: { id }, data });
  return mapGroup(row);
}

export async function deleteGroup(id: string): Promise<{ deleted: boolean; reason?: string }> {
  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) return { deleted: false, reason: "not_found" };

  // Block if any license references this group.
  const licenseCount = await prisma.license.count({ where: { groupId: id } });
  if (licenseCount > 0) {
    return { deleted: false, reason: `Grupa ma ${licenseCount} przypisanych licencji` };
  }

  // Block if any device references this group.
  const deviceCount = await prisma.licenseDevice.count({ where: { groupId: id } });
  if (deviceCount > 0) {
    return { deleted: false, reason: `Grupa ma ${deviceCount} przypisanych urzadzen` };
  }

  await prisma.group.delete({ where: { id } });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// License lookup by key
// ---------------------------------------------------------------------------

export async function findLicenseByKey(licenseKey: string): Promise<License | null> {
  const row = await prisma.license.findUnique({ where: { licenseKey } });
  if (!row) return null;
  return mapLicense(row, await activeDeviceIds(row.id));
}

export async function getGroupForLicense(licenseId: string): Promise<ClientGroup | null> {
  const rows = await prisma.group.findMany({ where: { licenseId }, orderBy: { id: "asc" } });
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    log("error", "license.multiple_groups_for_license", { licenseId, count: rows.length });
  }
  return mapGroup(rows[0]);
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
  return prisma.$transaction(async (tx) => {
    const license = await tx.license.findUnique({ where: { id: licenseId } });
    if (!license) throw new Error(`License not found: ${licenseId}`);

    const now = new Date();

    // Already registered under this license — just touch lastSeenAt.
    const existing = await tx.licenseDevice.findUnique({ where: { deviceId } });
    if (existing && existing.licenseId === licenseId) {
      const updated = await tx.licenseDevice.update({
        where: { deviceId },
        data: { lastSeenAt: now },
      });
      return mapDevice(updated);
    }

    // Device limit (counts only devices currently under this license).
    const activeCount = await tx.licenseDevice.count({ where: { licenseId } });
    if (activeCount >= license.maxDevices) {
      throw new Error(`Device limit reached (${license.maxDevices})`);
    }

    const group = await tx.group.findUnique({ where: { id: groupId } });
    const record = {
      deviceId,
      groupId,
      licenseId,
      deviceName,
      apiToken: generateApiToken(),
      registeredAt: now,
      lastSeenAt: now,
      lastSyncAt: null,
      lastMarkerHash: null,
      isFixedMaster: group?.fixedMasterDeviceId === deviceId,
    };
    // upsert: overwrites a device previously registered under another license.
    const row = await tx.licenseDevice.upsert({
      where: { deviceId },
      create: record,
      update: record,
    });
    return mapDevice(row);
  });
}

/**
 * Update lastSeenAt for a known device (called on every authenticated sync request).
 * Fire-and-forget — no-op if the device is unknown.
 */
export async function touchDeviceLastSeen(deviceId: string): Promise<void> {
  await prisma.licenseDevice.updateMany({
    where: { deviceId },
    data: { lastSeenAt: new Date() },
  });
}

/**
 * Record a device's E2E v2 capability (has a group passphrase). Fire-and-forget;
 * also refreshes lastSeenAt so migration readiness reflects current activity.
 */
export async function recordDeviceCapability(
  deviceId: string,
  supportsV2: boolean,
): Promise<void> {
  await prisma.licenseDevice.updateMany({
    where: { deviceId },
    data: { supportsV2, lastSeenAt: new Date() },
  });
}

/**
 * Fleet migration readiness for a group: whether all active devices are v2-capable.
 * Used to safely auto-accept v2 packages once a group has fully migrated.
 */
export async function getGroupKeySchemeStatus(groupId: string): Promise<GroupV2Status> {
  const rows = await prisma.licenseDevice.findMany({
    where: { groupId },
    select: { lastSeenAt: true, supportsV2: true },
  });
  return computeGroupV2Readiness(
    rows.map((r) => ({ lastSeenAt: r.lastSeenAt.toISOString(), supportsV2: r.supportsV2 })),
  );
}

/**
 * Update lastSyncAt and optionally lastMarkerHash after a completed sync.
 */
export async function updateDeviceLastSync(
  deviceId: string,
  markerHash?: string | null,
): Promise<void> {
  const now = new Date();
  const data: Prisma.LicenseDeviceUpdateManyMutationInput = {
    lastSyncAt: now,
    lastSeenAt: now,
  };
  if (markerHash !== undefined) {
    data.lastMarkerHash = markerHash;
  }
  await prisma.licenseDevice.updateMany({ where: { deviceId }, data });
}

export async function getDevice(deviceId: string): Promise<DeviceRegistration | null> {
  const row = await prisma.licenseDevice.findUnique({ where: { deviceId } });
  return row ? mapDevice(row) : null;
}

export async function getDevicesForLicense(licenseId: string): Promise<DeviceRegistration[]> {
  const rows = await prisma.licenseDevice.findMany({ where: { licenseId } });
  return rows.map(mapDevice);
}

export async function getAllDevices(): Promise<DeviceRegistration[]> {
  const rows = await prisma.licenseDevice.findMany();
  return rows.map(mapDevice);
}

export async function deregisterDevice(
  licenseId: string,
  deviceId: string,
): Promise<boolean> {
  const device = await prisma.licenseDevice.findUnique({ where: { deviceId } });
  if (!device || device.licenseId !== licenseId) return false;

  await prisma.licenseDevice.delete({ where: { deviceId } });
  return true;
}

export async function getDevicesForUser(userId: string): Promise<DeviceRegistration[]> {
  const groups = await prisma.group.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return [];

  const rows = await prisma.licenseDevice.findMany({
    where: { groupId: { in: groupIds } },
  });
  return rows.map(mapDevice);
}

export async function regenerateDeviceToken(
  licenseId: string,
  deviceId: string,
): Promise<DeviceRegistration | null> {
  const device = await prisma.licenseDevice.findUnique({ where: { deviceId } });
  if (!device || device.licenseId !== licenseId) return null;

  const row = await prisma.licenseDevice.update({
    where: { deviceId },
    data: { apiToken: generateApiToken() },
  });
  return mapDevice(row);
}

export async function findDeviceByToken(
  token: string,
): Promise<{ device: DeviceRegistration; group: ClientGroup } | null> {
  const device = await prisma.licenseDevice.findUnique({ where: { apiToken: token } });
  if (!device) return null;

  const group = await prisma.group.findUnique({ where: { id: device.groupId } });
  if (!group) return null;

  return { device: mapDevice(device), group: mapGroup(group) };
}

// ---------------------------------------------------------------------------
// Storage backend CRUD
// ---------------------------------------------------------------------------

export async function createStorageBackend(
  config: Omit<StorageBackendConfig, "id" | "createdAt">,
): Promise<StorageBackendConfig> {
  const { type, name, basePath, maxFileSizeMb, sessionTtlMinutes, ...typeSpecific } = config;
  const row = await prisma.storageBackend.create({
    data: {
      id: randomUUID(),
      type,
      name,
      basePath,
      maxFileSizeMb,
      sessionTtlMinutes,
      createdAt: new Date(),
      config: typeSpecific as Prisma.InputJsonValue,
    },
  });
  return mapBackend(row);
}

export async function getStorageBackend(id: string): Promise<StorageBackendConfig | null> {
  const row = await prisma.storageBackend.findUnique({ where: { id } });
  return row ? mapBackend(row) : null;
}

export async function getAllStorageBackends(): Promise<StorageBackendConfig[]> {
  const rows = await prisma.storageBackend.findMany();
  return rows.map(mapBackend);
}

export async function updateStorageBackend(
  id: string,
  updates: Partial<Omit<StorageBackendConfig, "id" | "createdAt" | "type">>,
): Promise<StorageBackendConfig | null> {
  const existing = await prisma.storageBackend.findUnique({ where: { id } });
  if (!existing) return null;

  const baseKeys = new Set(["name", "basePath", "maxFileSizeMb", "sessionTtlMinutes"]);
  const data: Prisma.StorageBackendUpdateInput = {};
  const nextConfig: Record<string, unknown> = {
    ...((existing.config ?? {}) as Record<string, unknown>),
  };

  // Only apply explicitly-provided keys so that omitting e.g. password
  // preserves the existing value.
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (baseKeys.has(key)) {
      (data as Record<string, unknown>)[key] = value;
    } else {
      nextConfig[key] = value;
    }
  }
  data.config = nextConfig as Prisma.InputJsonValue;

  const row = await prisma.storageBackend.update({ where: { id }, data });
  return mapBackend(row);
}

export async function deleteStorageBackend(id: string): Promise<{ deleted: boolean; reason?: string }> {
  const existing = await prisma.storageBackend.findUnique({ where: { id } });
  if (!existing) return { deleted: false, reason: "not_found" };

  // Block if any group references this backend.
  const assignedGroups = await prisma.group.findMany({
    where: { storageBackendId: id },
    select: { name: true },
  });
  if (assignedGroups.length > 0) {
    return {
      deleted: false,
      reason: `Backend is assigned to ${assignedGroups.length} group(s): ${assignedGroups
        .map((g) => g.name)
        .join(", ")}`,
    };
  }

  await prisma.storageBackend.delete({ where: { id } });
  return { deleted: true };
}
