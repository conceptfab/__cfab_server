import type { License, ClientGroup, DeviceRegistration, StorageBackendConfig } from "./license-contracts";
import type { SyncSession, AsyncDeltaPackage } from "./session-contracts";
import type { DirectSyncHistoryEntry } from "./direct-sync";
import { getAllLicenses, getAllGroups, getAllStorageBackends } from "./license-store";
import { getAllSessions, getAllAsyncPackages } from "./session-store";
import { getDirectSyncHistory } from "./direct-sync";

export interface DashboardData {
  licenses: License[];
  groups: ClientGroup[];
  devices: DeviceRegistration[];
  storageBackends: StorageBackendConfig[];
  sessions: SyncSession[];
  activeSessions: SyncSession[];
  completedSessions: SyncSession[];
  asyncPackages: AsyncDeltaPackage[];
  directSyncHistory: DirectSyncHistoryEntry[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const [licenses, groups, storageBackends, sessions, asyncPackages, directSyncHistory] = await Promise.all([
    getAllLicenses(),
    getAllGroups(),
    getAllStorageBackends(),
    getAllSessions(),
    getAllAsyncPackages(),
    getDirectSyncHistory(),
  ]);

  // Collect all devices from all licenses
  const { getDevicesForLicense } = await import("./license-store");
  const deviceArrays = await Promise.all(
    licenses.map((l) => getDevicesForLicense(l.id)),
  );
  const devices = deviceArrays.flat();

  const terminalStatuses = new Set(["completed", "failed", "expired", "cancelled"]);
  const activeSessions = sessions.filter((s) => !terminalStatuses.has(s.status));
  const completedSessions = sessions
    .filter((s) => terminalStatuses.has(s.status))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 50); // last 50

  return {
    licenses,
    groups,
    devices,
    storageBackends,
    sessions,
    activeSessions,
    completedSessions,
    asyncPackages,
    directSyncHistory,
  };
}
