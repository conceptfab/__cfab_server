import { ClearSyncHistoryButton } from "@/components/clear-sync-history-button";
import type { DirectSyncHistoryEntry } from "@/lib/sync/direct-sync";

import { DashboardEmptyState, DashboardPageHeader, formatDashboardDate } from "./dashboard-ui";

const ACTION_LABELS: Record<DirectSyncHistoryEntry["action"], string> = {
  push: "PUSH",
  "delta-push": "DELTA",
  pull: "PULL",
  ack: "ACK",
  status: "STATUS",
  test: "TEST",
};

export function ActivityView({ entries }: { entries: DirectSyncHistoryEntry[] }) {
  return (
    <>
      <DashboardPageHeader
        title="Aktywność synchronizacji"
        description="Historia operacji Direct Sync, rewizji i błędów."
        action={entries.length > 0 ? <ClearSyncHistoryButton /> : undefined}
      />
      <section className="dashboard-resource-panel">
        {entries.length === 0 ? (
          <DashboardEmptyState
            symbol="↕"
            title="Brak aktywności synchronizacji"
            description="Operacje pojawią się po pierwszym push, pull, delta lub teście połączenia."
          />
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th scope="col">Czas</th><th scope="col">Akcja</th><th scope="col">Status</th><th scope="col">Użytkownik</th><th scope="col">Urządzenie</th><th scope="col">Rewizja</th><th scope="col">Rozmiar</th><th scope="col">Szczegóły</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Czas">{formatDashboardDate(entry.timestamp)}</td>
                    <td data-label="Akcja"><span className={`dashboard-action-badge dashboard-action-badge--${entry.status}`}>{ACTION_LABELS[entry.action]}</span></td>
                    <td data-label="Status"><span className={`dashboard-status-badge dashboard-status-badge--${entry.status === "ok" ? "success" : entry.status === "error" ? "danger" : "neutral"}`}>{entry.status}</span></td>
                    <td data-label="Użytkownik" className="dashboard-mono">{entry.userId}</td>
                    <td data-label="Urządzenie" className="dashboard-mono">{entry.deviceId.slice(0, 12)}</td>
                    <td data-label="Rewizja" className="dashboard-mono">r{entry.revision}</td>
                    <td data-label="Rozmiar">{entry.sizeBytes == null ? "—" : `${(entry.sizeBytes / 1024).toFixed(1)} KB`}</td>
                    <td data-label="Szczegóły" className="dashboard-table-detail">{entry.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
