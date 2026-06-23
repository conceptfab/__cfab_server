import { CopyTokenButton } from "@/components/copy-token-button";
import type { DeviceRegistration } from "@/lib/sync/license-contracts";
import Link from "next/link";

import { DashboardEmptyState, DashboardPageHeader, formatDashboardDate } from "./dashboard-ui";

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function getDeviceStatus(device: DeviceRegistration, nowMs: number) {
  if (!device.lastSeenAt) return { label: "Nieznany", tone: "neutral" } as const;
  const elapsed = nowMs - new Date(device.lastSeenAt).getTime();
  if (elapsed < ONLINE_THRESHOLD_MS) {
    return device.lastSyncAt
      ? ({ label: "Online", tone: "success" } as const)
      : ({ label: "Połączony", tone: "info" } as const);
  }
  if (elapsed < 60 * 60 * 1000) return { label: "Niedawno", tone: "warning" } as const;
  return { label: "Offline", tone: "neutral" } as const;
}

export function DevicesView({
  devices,
  nowMs,
}: {
  devices: DeviceRegistration[];
  nowMs: number;
}) {
  const onlineCount = devices.filter((device) => getDeviceStatus(device, nowMs).tone === "success").length;

  return (
    <>
      <DashboardPageHeader
        title="Urządzenia"
        description="Zarejestrowane klienty i ostatni stan połączenia."
        action={<span className="dashboard-count-badge">{onlineCount} online / {devices.length}</span>}
      />
      <section className="dashboard-resource-panel">
        {devices.length === 0 ? (
          <DashboardEmptyState
            symbol="▣"
            title="Brak zarejestrowanych urządzeń"
            description="Urządzenie pojawi się tutaj po aktywacji licencji i pierwszym połączeniu z API synchronizacji."
            action={<Link className="dashboard-text-link" href="/?view=licenses">Otwórz licencje</Link>}
          />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th scope="col">Status</th><th scope="col">Urządzenie</th><th scope="col">Grupa</th><th scope="col">API token</th><th scope="col">Rola</th><th scope="col">Ostatnio widziane</th><th scope="col">Ostatni sync</th></tr></thead>
              <tbody>
                {devices.map((device) => {
                  const status = getDeviceStatus(device, nowMs);
                  return (
                    <tr key={device.deviceId}>
                      <td data-label="Status"><span className={`dashboard-status-badge dashboard-status-badge--${status.tone}`}>{status.label}</span></td>
                      <td data-label="Urządzenie"><strong>{device.deviceName}</strong><small className="dashboard-mono">{device.deviceId.slice(0, 12)}</small></td>
                      <td data-label="Grupa" className="dashboard-mono">{device.groupId.slice(0, 8)}</td>
                      <td data-label="API token">{device.apiToken ? <CopyTokenButton token={device.apiToken} /> : "—"}</td>
                      <td data-label="Rola">{device.isFixedMaster ? <span className="dashboard-status-badge dashboard-status-badge--info">Master</span> : "—"}</td>
                      <td data-label="Ostatnio widziane">{formatDashboardDate(device.lastSeenAt)}</td>
                      <td data-label="Ostatni sync">{formatDashboardDate(device.lastSyncAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
