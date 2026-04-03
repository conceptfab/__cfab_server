export const runtime = "nodejs";

import { handleSyncGet } from "@/lib/sync/http";
import { handleSyncOptions } from "@/lib/sync/http";
import {
  getAllGroups,
  getAllLicenses,
  getDevicesForLicense,
} from "@/lib/sync/license-store";
import { PLAN_DEFAULTS } from "@/lib/sync/license-contracts";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function GET(request: Request) {
  return handleSyncGet(request, {
    route: "session-status", // reuse existing route name for rate limiting
    extractParams: () => ({}),
    execute: async ({ userId }) => {
      const groups = await getAllGroups();
      const group = groups.find((g) => g.ownerId === userId);
      if (!group) {
        return {
          ok: true,
          hasLicense: false,
          message: "No group found for this user",
        };
      }

      const licenses = await getAllLicenses();
      const license = licenses.find((l) => l.id === group.licenseId);
      if (!license) {
        return {
          ok: true,
          hasLicense: false,
          message: "No license found for this group",
        };
      }

      const devices = await getDevicesForLicense(license.id);
      const planDefaults = PLAN_DEFAULTS[license.plan];

      return {
        ok: true,
        hasLicense: true,
        license: {
          id: license.id,
          plan: license.plan,
          status: license.status,
          expiresAt: license.expiresAt,
          maxDevices: license.maxDevices,
          activeDeviceCount: license.activeDevices.length,
        },
        group: {
          id: group.id,
          name: group.name,
          storageBackendId: group.storageBackendId,
          fixedMasterDeviceId: group.fixedMasterDeviceId,
          maxSyncFrequencyHours: group.maxSyncFrequencyHours ?? planDefaults.maxSyncFrequencyHours,
          maxDatabaseSizeMb: group.maxDatabaseSizeMb ?? planDefaults.maxDatabaseSizeMb,
        },
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          registeredAt: d.registeredAt,
          lastSeenAt: d.lastSeenAt,
          lastSyncAt: d.lastSyncAt,
          lastMarkerHash: d.lastMarkerHash,
          isFixedMaster: d.isFixedMaster,
        })),
      };
    },
  });
}
