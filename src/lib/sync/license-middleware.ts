import { forbidden, tooManyRequests, payloadTooLarge } from "@/lib/http/error";
import type { ClientGroup, License, DeviceRegistration } from "./license-contracts";
import { PLAN_DEFAULTS } from "./license-contracts";

export interface LicenseContext {
  license: License;
  group: ClientGroup;
  device: DeviceRegistration;
}

export interface LicenseValidationResult {
  ok: true;
  context: LicenseContext;
}

/**
 * Validates that a device is allowed to start a sync session.
 * Checks: license status, device limit, sync frequency, database size.
 */
export function validateLicenseForSync(
  license: License,
  group: ClientGroup,
  device: DeviceRegistration,
  deviceId: string,
): LicenseValidationResult {
  // 1. Check license status
  if (license.status === "expired") {
    throw forbidden(
      "License has expired. Please renew to continue syncing.",
      "license_expired",
    );
  }
  if (license.status === "suspended") {
    throw forbidden(
      "License is suspended. Contact support.",
      "license_suspended",
    );
  }
  if (license.status === "revoked") {
    throw forbidden(
      "License has been revoked.",
      "license_revoked",
    );
  }
  if (license.status !== "active" && license.status !== "trial") {
    throw forbidden(
      `License status '${license.status}' does not allow sync.`,
      "license_inactive",
    );
  }

  // 2. Check expiry date
  if (license.expiresAt) {
    const expiryTime = new Date(license.expiresAt).getTime();
    if (expiryTime < Date.now()) {
      throw forbidden(
        "License has expired. Please renew to continue syncing.",
        "license_expired",
      );
    }
  }

  // 3. Check device limit
  const isDeviceRegistered = license.activeDevices.includes(deviceId);
  if (!isDeviceRegistered && license.activeDevices.length >= license.maxDevices) {
    throw forbidden(
      `Device limit reached (${license.maxDevices}). Deactivate a device first.`,
      "device_limit_reached",
    );
  }

  // 4. Check sync frequency
  const maxFrequencyHours =
    group.maxSyncFrequencyHours ?? PLAN_DEFAULTS[license.plan].maxSyncFrequencyHours;
  if (maxFrequencyHours > 0 && device.lastSyncAt) {
    const lastSyncTime = new Date(device.lastSyncAt).getTime();
    const minIntervalMs = maxFrequencyHours * 60 * 60 * 1000;
    const nextAllowedAt = lastSyncTime + minIntervalMs;
    if (Date.now() < nextAllowedAt) {
      const retryAfterMs = nextAllowedAt - Date.now();
      throw tooManyRequests(
        `Sync too frequent. Next sync allowed in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
        "sync_too_frequent",
        { retryAfterMs },
      );
    }
  }

  return {
    ok: true,
    context: { license, group, device },
  };
}

/**
 * Validates database size against license plan limits.
 * Call separately when table_hashes/size info is available.
 */
export function validateDatabaseSize(
  license: License,
  group: ClientGroup,
  sizeBytes: number,
): void {
  const maxSizeMb =
    group.maxDatabaseSizeMb ?? PLAN_DEFAULTS[license.plan].maxDatabaseSizeMb;
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb > maxSizeMb) {
    throw payloadTooLarge(
      `Database size (${sizeMb.toFixed(1)} MB) exceeds plan limit (${maxSizeMb} MB).`,
      "database_too_large",
    );
  }
}

/**
 * Resolves the role for a device in a group, considering fixedMasterDeviceId.
 */
export function resolveGroupRole(
  group: ClientGroup,
  deviceId: string,
): "master" | "slave" | null {
  if (group.fixedMasterDeviceId) {
    return deviceId === group.fixedMasterDeviceId ? "master" : "slave";
  }
  return null; // Let session-level logic decide
}
