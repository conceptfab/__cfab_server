import type { DirectSyncHistoryEntry } from "@/lib/sync/direct-sync";

interface DashboardOverviewData {
  licenses: readonly unknown[];
  groups: readonly unknown[];
  devices: readonly unknown[];
  storageBackends: readonly unknown[];
  directSyncHistory: readonly DirectSyncHistoryEntry[];
}

interface DashboardStorageHealth {
  available: boolean;
  lastCheckAt: string;
  error: string | null;
}

export function buildDashboardOverview(
  data: DashboardOverviewData,
  storage: DashboardStorageHealth,
  uptimeSeconds: number,
) {
  const counts = {
    devices: data.devices.length,
    licenses: data.licenses.length,
    groups: data.groups.length,
    storageBackends: data.storageBackends.length,
  };
  const completed =
    1 +
    Number(storage.available) +
    Number(counts.licenses > 0) +
    Number(counts.devices > 0);

  return {
    systemStatus: storage.available
      ? ("operational" as const)
      : ("degraded" as const),
    uptimeSeconds,
    storage,
    counts,
    recentActivity: data.directSyncHistory.slice(0, 8),
    setup: { completed, total: 4 },
    alert: storage.available
      ? null
      : {
          title: "Storage jest niedostępny",
          description:
            storage.error ?? "Sprawdź konfigurację i połączenie backendu.",
          targetView: "storage" as const,
        },
  };
}

export type OverviewModel = ReturnType<typeof buildDashboardOverview>;
