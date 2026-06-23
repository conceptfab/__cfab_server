import type { ReactNode } from "react";

export function DashboardPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="dashboard-page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function StatusDot({
  status,
}: {
  status: "neutral" | "success" | "danger" | "warning";
}) {
  return <span aria-hidden="true" className={`status-dot status-dot--${status}`} />;
}

export function DashboardEmptyState({
  symbol,
  title,
  description,
  action,
}: {
  symbol: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="dashboard-empty-state">
      <div>
        <span className="dashboard-empty-symbol" aria-hidden="true">
          {symbol}
        </span>
        <strong>{title}</strong>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

export function formatDashboardDate(value: string | null | undefined): string {
  if (!value) return "brak";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pl-PL");
}

export function formatDashboardUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}
