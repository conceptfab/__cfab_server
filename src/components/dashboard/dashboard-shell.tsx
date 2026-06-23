import type { ReactNode } from "react";
import Link from "next/link";

import type { DashboardView } from "@/lib/dashboard/navigation";

import { DashboardCommandMenu } from "./dashboard-command-menu";

const NAV_ITEMS: ReadonlyArray<{
  view: DashboardView;
  label: string;
  icon: string;
}> = [
  { view: "overview", label: "Przegląd", icon: "⌂" },
  { view: "activity", label: "Aktywność", icon: "↕" },
  { view: "devices", label: "Urządzenia", icon: "▣" },
  { view: "licenses", label: "Licencje", icon: "◇" },
  { view: "groups", label: "Grupy", icon: "◎" },
  { view: "storage", label: "Storage", icon: "▤" },
];

export function DashboardShell({
  currentView,
  userId,
  children,
}: {
  currentView: DashboardView;
  userId: string;
  children: ReactNode;
}) {
  const currentLabel =
    NAV_ITEMS.find(({ view }) => view === currentView)?.label ?? "Przegląd";

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-rail">
        <Link className="dashboard-brand" href="/?view=overview">
          <span className="dashboard-mark" aria-hidden="true" />
          <span>TimeFlow Sync</span>
        </Link>

        <details className="dashboard-mobile-nav">
          <summary>Menu</summary>
          <nav aria-label="Mobilna nawigacja">
            {NAV_ITEMS.map(({ view, label }) => (
              <Link
                aria-current={currentView === view ? "page" : undefined}
                href={`/?view=${view}`}
                key={view}
              >
                {label}
              </Link>
            ))}
          </nav>
        </details>

        <div className="dashboard-workspace">
          <span>
            <strong>Production</strong>
            <small>sync server</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </div>

        <span className="dashboard-nav-label">Workspace</span>
        <nav aria-label="Panel synchronizacji">
          {NAV_ITEMS.map(({ view, label, icon }, index) => (
            <Link
              className={index === 3 ? "dashboard-nav-link dashboard-nav-link--separated" : "dashboard-nav-link"}
              href={`/?view=${view}`}
              aria-current={currentView === view ? "page" : undefined}
              key={view}
            >
              <span className="dashboard-nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="dashboard-account">
          <span className="dashboard-avatar" aria-hidden="true">
            {userId.slice(0, 1).toUpperCase()}
          </span>
          <span className="dashboard-account-copy">
            <strong>{userId}</strong>
            <small>Administrator</small>
          </span>
          <form action="/auth/logout" method="post">
            <button className="dashboard-icon-button" type="submit" aria-label="Wyloguj">
              ↗
            </button>
          </form>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <p>
            <span>TimeFlow Sync</span>
            <span aria-hidden="true"> / </span>
            <strong>{currentLabel}</strong>
          </p>
          <DashboardCommandMenu />
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
