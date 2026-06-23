import { cookies } from "next/headers";
import Link from "next/link";

import { ActivityView } from "@/components/dashboard/activity-view";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DevicesView } from "@/components/dashboard/devices-view";
import { GroupsView } from "@/components/dashboard/groups-view";
import { LicensesView } from "@/components/dashboard/licenses-view";
import { StorageView } from "@/components/dashboard/storage-view";
import { SyncStatusLoginForm } from "@/components/sync-status-login-form";
import {
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  SYNC_DASHBOARD_AUTH_COOKIE,
  getDashboardUserIdFromCookie,
} from "@/lib/auth/dashboard-page-auth";
import { parseDashboardView } from "@/lib/dashboard/navigation";
import { buildDashboardOverview } from "@/lib/dashboard/overview";
import { getDashboardData } from "@/lib/sync/dashboard";
import { healthCheck } from "@/lib/sync/sftp-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

interface HomePageProps {
  searchParams?: SearchParamsRecord | Promise<SearchParamsRecord>;
}

async function resolveSearchParams(
  searchParams: HomePageProps["searchParams"],
): Promise<SearchParamsRecord> {
  if (!searchParams) return {};
  if (typeof (searchParams as Promise<SearchParamsRecord>).then === "function") {
    return (await searchParams) ?? {};
  }
  return searchParams;
}

function getFirstQueryValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function LoginView({ authState }: { authState: string | null }) {
  return (
    <main className="dashboard-auth-page">
      <section className="dashboard-auth-card">
        <span className="dashboard-auth-brand">
          <span className="dashboard-mark" aria-hidden="true" />
          TimeFlow Sync
        </span>
        <h1>Dostęp do serwera</h1>
        <p>Zaloguj się identyfikatorem i tokenem administratora.</p>
        <SyncStatusLoginForm authState={authState} />
      </section>
    </main>
  );
}

export default async function Home({ searchParams }: HomePageProps) {
  try {
    const cookieStore = await cookies();
    const loggedUserId = getDashboardUserIdFromCookie(
      cookieStore.get(SYNC_DASHBOARD_AUTH_COOKIE)?.value ??
        cookieStore.get(LEGACY_SYNC_DASHBOARD_AUTH_COOKIE)?.value,
    );

    const resolvedSearchParams = await resolveSearchParams(searchParams);
    const authState = getFirstQueryValue(resolvedSearchParams.auth);

    if (!loggedUserId) {
      return <LoginView authState={authState} />;
    }

    const [data, storageHealth] = await Promise.all([
      getDashboardData(),
      healthCheck(),
    ]);
    const view = parseDashboardView(getFirstQueryValue(resolvedSearchParams.view));
    const overview = buildDashboardOverview(
      data,
      storageHealth,
      process.uptime(),
    );
    const nowMs = new Date(storageHealth.lastCheckAt).getTime();

    let content;
    switch (view) {
      case "activity":
        content = <ActivityView entries={data.directSyncHistory} />;
        break;
      case "devices":
        content = <DevicesView devices={data.devices} nowMs={nowMs} />;
        break;
      case "licenses":
        content = <LicensesView licenses={data.licenses} groups={data.groups} />;
        break;
      case "groups":
        content = (
          <GroupsView
            groups={data.groups}
            storageBackends={data.storageBackends}
            licenses={data.licenses}
          />
        );
        break;
      case "storage":
        content = <StorageView storageBackends={data.storageBackends} />;
        break;
      default:
        content = <DashboardOverview model={overview} />;
    }

    return (
      <DashboardShell currentView={view} userId={loggedUserId}>
        {content}
      </DashboardShell>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <main className="dashboard-auth-page">
        <section className="dashboard-error-card" role="alert">
          <span>TimeFlow Sync Server</span>
          <h1>Błąd odczytu statusu</h1>
          <p>{message}</p>
          <Link className="dashboard-button dashboard-button--primary" href="/">
            Spróbuj ponownie
          </Link>
        </section>
      </main>
    );
  }
}
