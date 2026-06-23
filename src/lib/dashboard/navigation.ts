export const DASHBOARD_VIEWS = [
  "overview",
  "activity",
  "devices",
  "licenses",
  "groups",
  "storage",
] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export function parseDashboardView(value: unknown): DashboardView {
  return typeof value === "string" &&
    DASHBOARD_VIEWS.includes(value as DashboardView)
    ? (value as DashboardView)
    : "overview";
}
