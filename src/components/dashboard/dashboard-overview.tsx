import type { OverviewModel } from "@/lib/dashboard/overview";
import Link from "next/link";

import {
  DashboardEmptyState,
  DashboardPageHeader,
  formatDashboardDate,
  formatDashboardUptime,
  StatusDot,
} from "./dashboard-ui";

const ACTION_LABELS = {
  push: "PUSH",
  "delta-push": "DELTA",
  pull: "PULL",
  ack: "ACK",
  status: "STATUS",
  test: "TEST",
} as const;

export function DashboardOverview({ model }: { model: OverviewModel }) {
  const setupSteps = [
    { label: "API server", hint: "Działa lokalnie", done: true, href: "/?view=overview" },
    {
      label: "Skonfiguruj storage",
      hint: "Dodaj backend SFTP, FTP lub S3",
      done: model.storage.available,
      href: "/?view=storage",
    },
    {
      label: "Utwórz licencję",
      hint: "Ustaw limit urządzeń",
      done: model.counts.licenses > 0,
      href: "/?view=licenses",
    },
    {
      label: "Połącz urządzenie",
      hint: "Wykonaj pierwszą synchronizację",
      done: model.counts.devices > 0,
      href: "/?view=devices",
    },
  ];

  return (
    <>
      <DashboardPageHeader
        title="Przegląd"
        description="Stan serwera synchronizacji i najnowsza aktywność."
        action={
          <Link className="dashboard-button dashboard-button--primary" href="/?view=overview">
            Odśwież status
          </Link>
        }
      />

      <section className="dashboard-status-grid" aria-label="Stan systemu">
        <article className="dashboard-status-cell">
          <span>Stan systemu</span>
          <strong>
            <StatusDot status={model.systemStatus === "operational" ? "success" : "danger"} />
            {model.systemStatus === "operational" ? "Działa" : "Ograniczony"}
          </strong>
          <small>{model.alert ? "1 komponent wymaga uwagi" : "Wszystkie komponenty działają"}</small>
        </article>
        <article className="dashboard-status-cell">
          <span>API server</span>
          <strong><StatusDot status="success" />Online</strong>
          <small>localhost:3000</small>
        </article>
        <article className="dashboard-status-cell">
          <span>Storage</span>
          <strong>
            <StatusDot status={model.storage.available ? "success" : "danger"} />
            {model.storage.available ? "Online" : "Offline"}
          </strong>
          <small>Sprawdzono {formatDashboardDate(model.storage.lastCheckAt)}</small>
        </article>
        <article className="dashboard-status-cell">
          <span>Uptime</span>
          <strong>{formatDashboardUptime(model.uptimeSeconds)}</strong>
          <small>Bieżący proces serwera</small>
        </article>
      </section>

      {model.alert && (
        <section className="dashboard-alert" role="alert">
          <span className="dashboard-alert-symbol" aria-hidden="true">!</span>
          <div>
            <strong>{model.alert.title}</strong>
            <p>{model.alert.description}</p>
          </div>
          <Link href={`/?view=${model.alert.targetView}`}>Otwórz ustawienia storage</Link>
        </section>
      )}

      <section className="dashboard-work-grid">
        <div className="dashboard-pane">
          <header className="dashboard-pane-header">
            <h2>Ostatnia aktywność synchronizacji</h2>
            <Link href="/?view=activity">Zobacz całość</Link>
          </header>
          {model.recentActivity.length === 0 ? (
            <DashboardEmptyState
              symbol="↕"
              title="Brak aktywności synchronizacji"
              description="Operacje push, pull i delta pojawią się tutaj razem ze statusem, urządzeniem, rewizją i czasem wykonania."
              action={<Link className="dashboard-text-link" href="/?view=devices">Otwórz urządzenia</Link>}
            />
          ) : (
            <div className="dashboard-activity-list">
              {model.recentActivity.map((entry) => (
                <article className="dashboard-activity-row" key={entry.id}>
                  <span className={`dashboard-action-badge dashboard-action-badge--${entry.status}`}>
                    {ACTION_LABELS[entry.action]}
                  </span>
                  <span>
                    <strong>{entry.deviceId.slice(0, 11)}</strong>
                    <small>{formatDashboardDate(entry.timestamp)}</small>
                  </span>
                  <span className="dashboard-revision">r{entry.revision}</span>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="dashboard-pane">
          <header className="dashboard-pane-header">
            <h2>Konfiguracja</h2>
            <span>{model.setup.completed} z {model.setup.total}</span>
          </header>
          <div className="dashboard-checklist">
            {setupSteps.map((step, index) => (
              <Link className="dashboard-check-row" href={step.href} key={step.label}>
                <span className={step.done ? "dashboard-check dashboard-check--done" : "dashboard-check"}>
                  {step.done ? "✓" : index + 1}
                </span>
                <span><strong>{step.label}</strong><small>{step.hint}</small></span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </aside>
      </section>

      <section className="dashboard-resource-strip" aria-label="Zasoby">
        {[
          ["Urządzenia", model.counts.devices, "devices"],
          ["Licencje", model.counts.licenses, "licenses"],
          ["Grupy", model.counts.groups, "groups"],
          ["Storage", model.counts.storageBackends, "storage"],
        ].map(([label, count, view]) => (
          <Link href={`/?view=${view}`} key={label}>
            <span>{label}</span><strong>{count}</strong>
          </Link>
        ))}
      </section>
    </>
  );
}
