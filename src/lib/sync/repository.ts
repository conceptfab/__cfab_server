import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DeviceSyncInfo,
  StoredSnapshot,
  SyncStoreFile,
  UserSyncRecord,
} from "@/lib/sync/contracts";

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "sync-store.json");

export type SyncDeliveryStatus = "up_to_date" | "pending" | "unknown";

export interface SyncDashboardDeviceSummary {
  deviceId: string;
  lastSeenAt: string;
  lastClientRevision: number | null;
  lastClientHash: string | null;
  status: SyncDeliveryStatus;
}

export interface SyncDashboardUserSummary {
  userId: string;
  snapshotCount: number;
  deviceCount: number;
  latestRevision: number | null;
  latestHash: string | null;
  latestReceivedAt: string | null;
  latestSourceDeviceId: string | null;
  pendingDevices: number;
  upToDateDevices: number;
  unknownDevices: number;
  devices: SyncDashboardDeviceSummary[];
}

export interface SyncDashboardSummary {
  dataDir: string;
  storeFile: string;
  generatedAt: string;
  userCount: number;
  snapshotCount: number;
  deviceCount: number;
  pendingDevices: number;
  upToDateDevices: number;
  unknownDevices: number;
  users: SyncDashboardUserSummary[];
}

type LegacySnapshot = {
  id?: unknown;
  revision?: unknown;
  payloadSha256?: unknown;
  receivedAt?: unknown;
  sourceDeviceId?: unknown;
  archive?: unknown;
  sizeBytes?: unknown;
};

type LegacyDevice = {
  lastSeenAt?: unknown;
  lastClientRevision?: unknown;
  lastClientHash?: unknown;
};

type LegacyUser = {
  latestSnapshot?: LegacySnapshot;
  snapshots?: LegacySnapshot[];
  devices?: Record<string, LegacyDevice>;
};

type LegacyStore = {
  version?: unknown;
  users?: Record<string, LegacyUser>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDevice(device: LegacyDevice | undefined): DeviceSyncInfo | null {
  if (!device) return null;
  const lastSeenAt = asString(device.lastSeenAt);
  if (!lastSeenAt) return null;
  return {
    lastSeenAt,
    lastClientRevision: asNullableNumber(device.lastClientRevision),
    lastClientHash: asNullableString(device.lastClientHash),
  };
}

function normalizeSnapshot(snapshot: LegacySnapshot | undefined): StoredSnapshot | null {
  if (!snapshot) return null;
  const revision = asNullableNumber(snapshot.revision);
  const payloadSha256 = asString(snapshot.payloadSha256);
  const receivedAt = asString(snapshot.receivedAt);
  const sourceDeviceId = asString(snapshot.sourceDeviceId);
  if (
    revision === null ||
    payloadSha256 === null ||
    receivedAt === null ||
    sourceDeviceId === null
  ) {
    return null;
  }

  return {
    id: asString(snapshot.id) ?? `${revision}-${payloadSha256}`,
    revision,
    payloadSha256,
    receivedAt,
    sourceDeviceId,
    sizeBytes: asNullableNumber(snapshot.sizeBytes) ?? 0,
    archive: (snapshot.archive ?? null) as StoredSnapshot["archive"],
  };
}

function emptyUserRecord(): UserSyncRecord {
  return {
    latestSnapshot: null,
    snapshots: [],
    devices: {},
  };
}

function emptyStore(): SyncStoreFile {
  return {
    version: 2,
    users: {},
  };
}

function normalizeStore(input: unknown): SyncStoreFile {
  if (!isObject(input)) {
    return emptyStore();
  }

  const legacy = input as LegacyStore;
  if (!isObject(legacy.users)) {
    return emptyStore();
  }

  const store = emptyStore();

  for (const [userId, rawUser] of Object.entries(legacy.users)) {
    if (!isObject(rawUser)) continue;

    const userRecord = emptyUserRecord();
    const legacyUser = rawUser as LegacyUser;

    if (Array.isArray(legacyUser.snapshots)) {
      for (const rawSnapshot of legacyUser.snapshots) {
        if (!isObject(rawSnapshot)) continue;
        const snapshot = normalizeSnapshot(rawSnapshot);
        if (snapshot) userRecord.snapshots.push(snapshot);
      }
    }

    const latestSnapshot = normalizeSnapshot(legacyUser.latestSnapshot);
    if (latestSnapshot) {
      const exists = userRecord.snapshots.some(
        (snapshot) =>
          snapshot.revision === latestSnapshot.revision &&
          snapshot.payloadSha256 === latestSnapshot.payloadSha256,
      );
      if (!exists) {
        userRecord.snapshots.push(latestSnapshot);
      }
    }

    userRecord.snapshots.sort((a, b) => a.revision - b.revision);
    userRecord.latestSnapshot =
      userRecord.snapshots[userRecord.snapshots.length - 1] ?? null;

    if (isObject(legacyUser.devices)) {
      for (const [deviceId, rawDevice] of Object.entries(legacyUser.devices)) {
        if (!isObject(rawDevice)) continue;
        const device = normalizeDevice(rawDevice);
        if (device) {
          userRecord.devices[deviceId] = device;
        }
      }
    }

    store.users[userId] = userRecord;
  }

  return store;
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<SyncStoreFile> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return normalizeStore(JSON.parse(raw) as unknown);
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

async function writeStore(store: SyncStoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function getDeviceDeliveryStatus(
  device: DeviceSyncInfo,
  latest: StoredSnapshot | null,
): SyncDeliveryStatus {
  if (!latest) {
    return "unknown";
  }

  if (device.lastClientHash && device.lastClientHash === latest.payloadSha256) {
    return "up_to_date";
  }

  if (typeof device.lastClientRevision === "number") {
    if (device.lastClientRevision >= latest.revision) {
      return "up_to_date";
    }
    if (device.lastClientRevision < latest.revision) {
      return "pending";
    }
  }

  if (device.lastClientHash) {
    return device.lastClientHash === latest.payloadSha256 ? "up_to_date" : "pending";
  }

  return "unknown";
}

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

export interface SyncRepository {
  withUserState<T>(
    userId: string,
    mutator: (user: UserSyncRecord) => Promise<T> | T,
  ): Promise<T>;
}

export class FileSyncRepository implements SyncRepository {
  async withUserState<T>(
    userId: string,
    mutator: (user: UserSyncRecord) => Promise<T> | T,
  ): Promise<T> {
    return withMutex(async () => {
      const store = await readStore();
      const user = store.users[userId] ?? emptyUserRecord();
      store.users[userId] = user;

      const result = await mutator(user);
      user.snapshots.sort((a, b) => a.revision - b.revision);
      user.latestSnapshot = user.snapshots[user.snapshots.length - 1] ?? null;

      await writeStore(store);
      return result;
    });
  }
}

let defaultRepository: SyncRepository | null = null;

export function getSyncRepository(): SyncRepository {
  defaultRepository ??= new FileSyncRepository();
  return defaultRepository;
}

export async function getSyncDashboardSummary(): Promise<SyncDashboardSummary> {
  const store = await readStore();
  const users: SyncDashboardUserSummary[] = [];

  let snapshotCount = 0;
  let deviceCount = 0;
  let pendingDevices = 0;
  let upToDateDevices = 0;
  let unknownDevices = 0;

  for (const [userId, user] of Object.entries(store.users)) {
    const latest = user.latestSnapshot;
    const devices = Object.entries(user.devices)
      .map(([deviceId, device]) => {
        const status = getDeviceDeliveryStatus(device, latest);
        return {
          deviceId,
          lastSeenAt: device.lastSeenAt,
          lastClientRevision: device.lastClientRevision,
          lastClientHash: device.lastClientHash,
          status,
        } satisfies SyncDashboardDeviceSummary;
      })
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

    const userPendingDevices = devices.filter((device) => device.status === "pending").length;
    const userUpToDateDevices = devices.filter(
      (device) => device.status === "up_to_date",
    ).length;
    const userUnknownDevices = devices.filter((device) => device.status === "unknown").length;

    snapshotCount += user.snapshots.length;
    deviceCount += devices.length;
    pendingDevices += userPendingDevices;
    upToDateDevices += userUpToDateDevices;
    unknownDevices += userUnknownDevices;

    users.push({
      userId,
      snapshotCount: user.snapshots.length,
      deviceCount: devices.length,
      latestRevision: latest?.revision ?? null,
      latestHash: latest?.payloadSha256 ?? null,
      latestReceivedAt: latest?.receivedAt ?? null,
      latestSourceDeviceId: latest?.sourceDeviceId ?? null,
      pendingDevices: userPendingDevices,
      upToDateDevices: userUpToDateDevices,
      unknownDevices: userUnknownDevices,
      devices,
    });
  }

  users.sort((a, b) => {
    const left = a.latestReceivedAt ?? "";
    const right = b.latestReceivedAt ?? "";
    return right.localeCompare(left);
  });

  return {
    dataDir: DATA_DIR,
    storeFile: STORE_FILE,
    generatedAt: new Date().toISOString(),
    userCount: users.length,
    snapshotCount,
    deviceCount,
    pendingDevices,
    upToDateDevices,
    unknownDevices,
    users,
  };
}
