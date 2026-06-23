import type { License, ClientGroup, DeviceRegistration, StorageBackendConfig } from "./license-contracts";
import type { DirectSyncHistoryEntry } from "./direct-sync";
import { getAllLicenses, getAllGroups, getAllStorageBackends, getAllDevices } from "./license-store";
import { getDirectSyncHistory } from "./direct-sync";
import {
  createStorageAdapter,
  getGlobalStorageAdapter,
  type StorageAdapter,
} from "./sftp-manager";

export interface DashboardData {
  licenses: License[];
  groups: ClientGroup[];
  devices: DeviceRegistration[];
  storageBackends: StorageBackendConfig[];
  directSyncHistory: DirectSyncHistoryEntry[];
}

export interface DashboardStorageHealth {
  available: boolean;
  lastCheckAt: string;
  error: string | null;
  activeSessions: number;
  configuredCount: number;
  healthyCount: number;
}

/**
 * Aggregate storage health for the dashboard.
 *
 * Unlike the legacy `healthCheck()` (which only probes the global SFTP from
 * env vars), this considers every configured backend — SFTP, FTP and S3 stored
 * in the database — plus the optional global SFTP fallback. Storage is
 * reported as available when at least one configured backend is reachable.
 */
export async function getDashboardStorageHealth(): Promise<DashboardStorageHealth> {
  const lastCheckAt = new Date().toISOString();

  const backends = await getAllStorageBackends();
  const adapters: StorageAdapter[] = [];
  for (const backend of backends) {
    try {
      adapters.push(createStorageAdapter(backend));
    } catch {
      // Unknown/misconfigured backend type — counts as configured-but-broken below.
    }
  }

  // Global SFTP fallback from env vars (not represented in the DB list).
  const globalAdapter = getGlobalStorageAdapter();
  if (globalAdapter) adapters.push(globalAdapter);

  const configuredCount = backends.length + (globalAdapter ? 1 : 0);

  if (configuredCount === 0) {
    return {
      available: false,
      lastCheckAt,
      error: "Brak skonfigurowanego storage. Dodaj backend SFTP, FTP lub S3.",
      activeSessions: 0,
      configuredCount: 0,
      healthyCount: 0,
    };
  }

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        await adapter.healthCheck();
        const dirs = await adapter.listSessionDirs().catch(() => []);
        return { ok: true as const, sessions: dirs.length };
      } catch {
        return { ok: false as const, sessions: 0 };
      }
    }),
  );

  const healthy = results.filter((r) => r.ok);
  const available = healthy.length > 0;

  return {
    available,
    lastCheckAt,
    activeSessions: healthy.reduce((sum, r) => sum + r.sessions, 0),
    configuredCount,
    healthyCount: healthy.length,
    error: available
      ? null
      : `Wszystkie skonfigurowane backendy storage (${configuredCount}) są niedostępne.`,
  };
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
