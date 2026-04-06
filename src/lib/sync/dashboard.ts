import type { License, ClientGroup, DeviceRegistration, StorageBackendConfig } from "./license-contracts";
import type { DirectSyncHistoryEntry } from "./direct-sync";
import { getAllLicenses, getAllGroups, getAllStorageBackends } from "./license-store";
import { getDirectSyncHistory } from "./direct-sync";

export interface DashboardData {
  licenses: License[];
  groups: ClientGroup[];
  devices: DeviceRegistration[];
  storageBackends: StorageBackendConfig[];
  directSyncHistory: DirectSyncHistoryEntry[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const [licenses, groups, storageBackends, directSyncHistory] = await Promise.all([
    getAllLicenses(),
    getAllGroups(),
    getAllStorageBackends(),
    getDirectSyncHistory(),
  ]);

  // Collect all devices from all licenses
  const { getDevicesForLicense } = await import("./license-store");
  const deviceArrays = await Promise.all(
    licenses.map((l) => getDevicesForLicense(l.id)),
  );
  const devices = deviceArrays.flat();

  return {
    licenses,
    groups,
    devices,
    storageBackends,
    directSyncHistory,
  };
}
