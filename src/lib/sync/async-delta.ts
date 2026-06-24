import { randomUUID } from "node:crypto";

import type {
  AsyncDeltaPackage,
  AsyncPushBody,
  AsyncPushResponse,
  AsyncPendingResponse,
  AsyncAckBody,
  AsyncAckResponse,
  AsyncRejectBody,
  AsyncRejectResponse,
} from "./session-contracts";
import {
  createAsyncPackage,
  getPendingPackagesForGroup,
  getAsyncPackage,
  updateAsyncPackageStatus,
  recordAsyncDelivery,
  getAckedDeviceIds,
  getActiveDeviceIdsForGroup,
} from "./session-store";
import { getStorageBackend, getAllGroups } from "./license-store";
import { createStorageAdapter, getGlobalStorageAdapter } from "./sftp-manager";
import type { StorageAdapter } from "./sftp-manager";
import { encryptCredentialsWithFileKey, deriveGroupKey } from "./storage-encryption";
import { log } from "@/lib/observability/logger";

const ASYNC_PACKAGE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

// ---------------------------------------------------------------------------
// Resolve storage adapter for a group
// ---------------------------------------------------------------------------

async function resolveAdapterForGroup(
  groupId: string,
): Promise<{ adapter: StorageAdapter; backendId: string | null }> {
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === groupId);

  if (group?.storageBackendId && group.storageBackendId !== "default") {
    const backend = await getStorageBackend(group.storageBackendId);
    if (backend) {
      return { adapter: createStorageAdapter(backend), backendId: backend.id };
    }
  }

  const globalAdapter = getGlobalStorageAdapter();
  if (!globalAdapter) {
    throw new Error("No storage backend available (no group backend, no global SFTP)");
  }
  return { adapter: globalAdapter, backendId: null };
}

// ---------------------------------------------------------------------------
// Push: register async delta package
// ---------------------------------------------------------------------------

export async function handleAsyncPush(
  userId: string,
  body: AsyncPushBody,
): Promise<AsyncPushResponse> {
  const { deviceId, groupId, baseMarkerHash, newMarkerHash, fileSizeBytes } = body;

  // Verify group exists and user has access
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }
  if (group.ownerId !== userId) {
    throw new Error("Not authorized for this group");
  }

  // Check for existing pending package from this device → force pull first
  const existingPending = await getPendingPackagesForGroup(groupId, deviceId);
  if (existingPending.length > 0) {
    throw new Error(
      "There are pending packages for your group. Pull and apply them first before pushing.",
    );
  }

  // Resolve storage
  const { adapter, backendId } = await resolveAdapterForGroup(groupId);

  const packageId = randomUUID();
  const asyncDirName = `async/${packageId}`;

  // Create directory on storage
  const storagePath = await adapter.createSessionDir(asyncDirName);

  // Build encrypted credentials for the client
  const connInfo = adapter.getConnectionInfo(asyncDirName);
  let storageCredentials: AsyncPushResponse["storageCredentials"] = null;
  try {
    const encrypted = encryptCredentialsWithFileKey(
      {
        host: connInfo.host,
        port: connInfo.port,
        protocol: connInfo.protocol as "sftp" | "ftp",
        username: connInfo.username,
        password: connInfo.password,
        uploadPath: connInfo.uploadPath,
        downloadPath: connInfo.downloadPath,
        secure: connInfo.secure,
      },
      packageId,
      deriveGroupKey(groupId),
    );
    storageCredentials = { encrypted };
  } catch {
    // Encryption key may not be configured — credentials will be null
  }

  const now = new Date();
  const pkg: AsyncDeltaPackage = {
    id: packageId,
    groupId,
    fromDeviceId: deviceId,
    toGroupDevices: true,
    baseMarkerHash,
    newMarkerHash,
    storagePath,
    storageBackendId: backendId,
    status: "pending",
    fileSizeBytes,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ASYNC_PACKAGE_TTL_MS).toISOString(),
    deliveredAt: null,
    deliveredToDeviceId: null,
  };

  await createAsyncPackage(pkg);

  log("info", "async-delta.push", {
    packageId,
    groupId,
    fromDeviceId: deviceId,
    baseMarkerHash,
    newMarkerHash,
    fileSizeBytes,
  });

  return {
    ok: true,
    packageId,
    storagePath,
    storageCredentials,
    expiresAt: pkg.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Pending: list packages waiting for this device
// ---------------------------------------------------------------------------

export async function handleAsyncPending(
  userId: string,
  deviceId: string,
  groupId: string,
): Promise<AsyncPendingResponse> {
  // Verify access
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group || group.ownerId !== userId) {
    throw new Error("Not authorized for this group");
  }

  const packages = await getPendingPackagesForGroup(groupId, deviceId);

  return { ok: true, packages };
}

// ---------------------------------------------------------------------------
// Ack: confirm package was applied
// ---------------------------------------------------------------------------

export async function handleAsyncAck(
  userId: string,
  body: AsyncAckBody,
): Promise<AsyncAckResponse> {
  const { deviceId, packageId } = body;

  const pkg = await getAsyncPackage(packageId);
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  // Verify user owns the group
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === pkg.groupId);
  if (!group || group.ownerId !== userId) {
    throw new Error("Not authorized for this group");
  }

  if (pkg.status !== "pending") {
    return { ok: true, acknowledged: false };
  }

  // Multi-receiver: zapisz potwierdzenie tego urządzenia. Paczka → delivered
  // dopiero gdy WSZYSTKIE aktywne urządzenia grupy (poza nadawcą) potwierdziły.
  await recordAsyncDelivery(packageId, deviceId);

  const acked = new Set(await getAckedDeviceIds(packageId));
  const active = await getActiveDeviceIdsForGroup(pkg.groupId);
  const expectedRecipients = active.filter((d) => d !== pkg.fromDeviceId);
  const allAcked =
    expectedRecipients.length > 0 && expectedRecipients.every((d) => acked.has(d));

  if (allAcked) {
    await updateAsyncPackageStatus(packageId, "delivered", { deliveredToDeviceId: deviceId });
  }

  log("info", "async-delta.ack", {
    packageId,
    deviceId,
    ackedCount: acked.size,
    expectedRecipients: expectedRecipients.length,
    delivered: allAcked,
  });

  return { ok: true, acknowledged: true };
}

// ---------------------------------------------------------------------------
// Reject: base marker mismatch or other issue
// ---------------------------------------------------------------------------

export async function handleAsyncReject(
  userId: string,
  body: AsyncRejectBody,
): Promise<AsyncRejectResponse> {
  const { deviceId, packageId, reason } = body;

  const pkg = await getAsyncPackage(packageId);
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  // Verify user owns the group
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === pkg.groupId);
  if (!group || group.ownerId !== userId) {
    throw new Error("Not authorized for this group");
  }

  if (pkg.status !== "pending") {
    return { ok: true, rejected: false };
  }

  await updateAsyncPackageStatus(packageId, "rejected");

  // Serwer nie dotyka danych na FTP klienta (E2E) — przy reject plik zostaje na
  // FTP do decyzji klienta. Aktualizujemy tylko status paczki w DB.
  log("info", "async-delta.reject", { packageId, deviceId, reason });

  return { ok: true, rejected: true };
}

// ---------------------------------------------------------------------------
// Credentials: get storage credentials for pulling a package
// ---------------------------------------------------------------------------

export interface AsyncCredentialsResponse {
  ok: true;
  storageCredentials: { encrypted: import("./storage-encryption").EncryptedCredentials } | null;
}

export async function handleAsyncCredentials(
  userId: string,
  deviceId: string,
  packageId: string,
): Promise<AsyncCredentialsResponse> {
  const pkg = await getAsyncPackage(packageId);
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }

  // Verify user owns the group
  const groups = await getAllGroups();
  const group = groups.find((g) => g.id === pkg.groupId);
  if (!group || group.ownerId !== userId) {
    throw new Error("Not authorized for this group");
  }

  if (pkg.status !== "pending") {
    throw new Error(`Package ${packageId} is not pending (status: ${pkg.status})`);
  }

  // Resolve storage adapter for this package's group
  const { adapter } = await resolveAdapterForGroup(pkg.groupId);

  // Build encrypted credentials for the puller
  const asyncDirName = `async/${packageId}`;
  const connInfo = adapter.getConnectionInfo(asyncDirName);

  let storageCredentials: AsyncCredentialsResponse["storageCredentials"] = null;
  try {
    const encrypted = encryptCredentialsWithFileKey(
      {
        host: connInfo.host,
        port: connInfo.port,
        protocol: connInfo.protocol as "sftp" | "ftp",
        username: connInfo.username,
        password: connInfo.password,
        uploadPath: connInfo.uploadPath,
        downloadPath: connInfo.downloadPath,
        secure: connInfo.secure,
      },
      packageId,
      deriveGroupKey(pkg.groupId),
    );
    storageCredentials = { encrypted };
  } catch {
    // Encryption key not configured
  }

  return { ok: true, storageCredentials };
}
