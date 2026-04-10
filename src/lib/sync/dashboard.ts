import type { License, ClientGroup, DeviceRegistration, StorageBackendConfig } from "./license-contracts";
import type { DirectSyncHistoryEntry } from "./direct-sync";
import { getAllLicenses, getAllGroups, getAllStorageBackends, getAllDevices } from "./license-store";
import { getDirectSyncHistory } from "./direct-sync";

export interface DashboardData {
  licenses: License[];
  groups: ClientGroup[];
  devices: DeviceRegistration[];
  storageBackends: StorageBackendConfig[];
  directSyncHistory: DirectSyncHistoryEntry[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const [licenses, groups, devices, storageBackends, directSyncHistory] = await Promise.all([
    getAllLicenses(),
    getAllGroups(),
    getAllDevices(),
    getAllStorageBackends(),
    getDirectSyncHistory(),
  ]);

  return {
    licenses,
    groups,
    devices,
    storageBackends,
    directSyncHistory,
  };
}
