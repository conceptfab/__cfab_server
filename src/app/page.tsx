import { cookies } from "next/headers";

import { CreateLicenseForm, DeleteLicenseButton } from "@/components/create-license-form";
import { CreateGroupForm } from "@/components/group-form";
import { CreateStorageBackendForm, GroupBackendSelector, DeleteStorageBackendButton, TestStorageBackendButton } from "@/components/storage-backend-form";
import { SyncStatusLoginForm } from "@/components/sync-status-login-form";
import {
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  SYNC_DASHBOARD_AUTH_COOKIE,
  getDashboardUserIdFromCookie,
} from "@/lib/auth/dashboard-page-auth";
import type { SyncSession, SyncSessionStatus, SyncStepLog, AsyncDeltaPackage, AsyncPackageStatus } from "@/lib/sync/session-contracts";
import type { License, ClientGroup, DeviceRegistration, StorageBackendConfig, LicenseStatus } from "@/lib/sync/license-contracts";
import { getDashboardData, type DashboardData } from "@/lib/sync/dashboard";
import type { DirectSyncHistoryEntry } from "@/lib/sync/direct-sync";
import { healthCheck, type SftpHealthStatus } from "@/lib/sync/sftp-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

interface HomePageProps {
  searchParams?: SearchParamsRecord | Promise<SearchParamsRecord>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value: string | null | undefined): string {
  if (!value) return "brak";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pl-PL");
}

function formatUptime(totalSeconds: number): string {
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

function sessionStatusBadge(status: SyncSessionStatus): { label: string; className: string } {
  switch (status) {
    case "awaiting_peer":
      return { label: "Oczekuje na peera", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
    case "negotiating":
      return { label: "Negocjacja", className: "border-blue-500/40 bg-blue-500/10 text-blue-200" };
    case "in_progress":
      return { label: "W toku", className: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" };
    case "completed":
      return { label: "Zakonczona", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    case "failed":
      return { label: "Blad", className: "border-rose-500/40 bg-rose-500/10 text-rose-200" };
    case "expired":
      return { label: "Wygasla", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
    case "cancelled":
      return { label: "Anulowana", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
    default:
      return { label: status, className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
  }
}

function licenseStatusBadge(status: LicenseStatus): { label: string; className: string } {
  switch (status) {
    case "active":
      return { label: "Aktywna", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    case "trial":
      return { label: "Trial", className: "border-blue-500/40 bg-blue-500/10 text-blue-200" };
    case "expired":
      return { label: "Wygasla", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
    case "suspended":
      return { label: "Zawieszona", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
    case "revoked":
      return { label: "Cofnieta", className: "border-rose-500/40 bg-rose-500/10 text-rose-200" };
    default:
      return { label: status, className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
  }
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

// ---------------------------------------------------------------------------
// Login view
// ---------------------------------------------------------------------------

function LoginView({ authState }: { authState: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl shadow-black/30">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
          Panel
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Dostep</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Wprowadz dane.</p>
        <SyncStatusLoginForm authState={authState} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Section: Aktywne sesje sync
// ---------------------------------------------------------------------------

function ActiveSessionsSection({ sessions }: { sessions: SyncSession[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <h2 className="text-sm font-medium text-zinc-200">Aktywne sesje sync</h2>
      {sessions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak aktywnych sesji.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Master</th>
                <th className="px-3 py-2">Slave</th>
                <th className="px-3 py-2">Tryb</th>
                <th className="px-3 py-2">Krok</th>
                <th className="px-3 py-2">Utworzona</th>
                <th className="px-3 py-2">Wygasa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {sessions.map((session) => {
                const sBadge = sessionStatusBadge(session.status);
                const isExpired = new Date(session.expiresAt).getTime() < Date.now();
                return (
                  <tr key={session.id}>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">
                      {session.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${sBadge.className}`}>
                        {sBadge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                      {session.masterDeviceId.slice(0, 12)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                      {session.slaveDeviceId ? session.slaveDeviceId.slice(0, 12) : "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {session.syncMode ?? "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {session.currentStep}/13
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {formatDate(session.createdAt)}
                    </td>
                    <td className={`px-3 py-3 ${isExpired ? "text-rose-300" : "text-zinc-300"}`}>
                      {formatDate(session.expiresAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Step log for active sessions */}
          {sessions.filter((s) => s.stepLog.length > 0).map((session) => (
            <details key={`log-${session.id}`} className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <summary className="cursor-pointer text-xs font-medium text-zinc-400">
                Step log — {session.id.slice(0, 8)} ({session.stepLog.length} wpisow)
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-zinc-600">
                    <tr>
                      <th className="px-2 py-1">Krok</th>
                      <th className="px-2 py-1">Faza</th>
                      <th className="px-2 py-1">Akcja</th>
                      <th className="px-2 py-1">Device</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Czas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {session.stepLog.map((entry: SyncStepLog, idx: number) => (
                      <tr key={idx}>
                        <td className="px-2 py-1 text-zinc-300">{entry.step}</td>
                        <td className="px-2 py-1 text-zinc-400">{entry.phase}</td>
                        <td className="px-2 py-1 text-zinc-300">{entry.action}</td>
                        <td className="px-2 py-1 font-mono text-zinc-400">{entry.deviceId.slice(0, 8)}</td>
                        <td className="px-2 py-1">
                          <span className={
                            entry.status === "ok" ? "text-emerald-400"
                            : entry.status === "error" ? "text-rose-400"
                            : "text-amber-400"
                          }>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-zinc-500">{formatDate(entry.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Licencje
// ---------------------------------------------------------------------------

function LicensesSection({ licenses, groups }: { licenses: License[]; groups: ClientGroup[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Licencje</h2>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {licenses.length}
        </span>
      </div>
      <CreateLicenseForm groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
      {licenses.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak licencji.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Klucz</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Urzadzenia</th>
                <th className="px-3 py-2">Grupa</th>
                <th className="px-3 py-2">Wygasa</th>
                <th className="px-3 py-2">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {licenses.map((lic) => {
                const badge = licenseStatusBadge(lic.status);
                const groupName = groups.find((g) => g.id === lic.groupId)?.name;
                return (
                  <tr key={lic.id}>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">{lic.id.slice(0, 8)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{lic.licenseKey}</td>
                    <td className="px-3 py-3 text-zinc-300 uppercase text-xs">{lic.plan}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-300">
                      {lic.activeDevices.length}/{lic.maxDevices}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-400">{groupName ?? lic.groupId.slice(0, 8)}</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(lic.expiresAt)}</td>
                    <td className="px-3 py-3">
                      <DeleteLicenseButton licenseId={lic.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Grupy klientow
// ---------------------------------------------------------------------------

function GroupsSection({ groups, storageBackends, licenses }: { groups: ClientGroup[]; storageBackends: StorageBackendConfig[]; licenses: License[] }) {
  const backendOptions = storageBackends.map((b) => ({ id: b.id, name: `${b.name} (${b.type})` }));
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-zinc-200">Grupy klientow</h2>
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {groups.length}
          </span>
        </div>
        <CreateGroupForm
          licenses={licenses.map((l) => ({
            id: l.id,
            licenseKey: l.licenseKey,
            plan: l.plan,
          }))}
          storageBackends={storageBackends.map((b) => ({
            id: b.id,
            name: b.name,
            type: b.type,
          }))}
        />
      </div>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak grup.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Nazwa</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Storage backend</th>
                <th className="px-3 py-2">Fixed master</th>
                <th className="px-3 py-2">Max sync freq (h)</th>
                <th className="px-3 py-2">Max DB (MB)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-200">{g.id.slice(0, 8)}</td>
                  <td className="px-3 py-3 text-zinc-200">{g.name}</td>
                  <td className="px-3 py-3 text-zinc-300">{g.ownerId}</td>
                  <td className="px-3 py-3">
                    <GroupBackendSelector
                      groupId={g.id}
                      currentBackendId={g.storageBackendId}
                      backends={backendOptions}
                    />
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-400">
                    {g.fixedMasterDeviceId ? g.fixedMasterDeviceId.slice(0, 10) : "\u2014"}
                  </td>
                  <td className="px-3 py-3 text-zinc-300">{g.maxSyncFrequencyHours ?? "\u2014"}</td>
                  <td className="px-3 py-3 text-zinc-300">{g.maxDatabaseSizeMb ?? "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Storage backends
// ---------------------------------------------------------------------------

function StorageBackendsSection({ storageBackends }: { storageBackends: StorageBackendConfig[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Storage backends</h2>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {storageBackends.length}
        </span>
      </div>

      <CreateStorageBackendForm />

      {storageBackends.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak dodatkowych backendow.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Nazwa</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Host / Bucket</th>
                <th className="px-3 py-2">Base path</th>
                <th className="px-3 py-2">Max plik (MB)</th>
                <th className="px-3 py-2">TTL sesji (min)</th>
                <th className="px-3 py-2">Utworzony</th>
                <th className="px-3 py-2">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {storageBackends.map((sb) => (
                <tr key={sb.id}>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-200">{sb.id.slice(0, 8)}</td>
                  <td className="px-3 py-3 text-zinc-200">{sb.name}</td>
                  <td className="px-3 py-3 text-zinc-300 uppercase text-xs">{sb.type}</td>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                    {sb.type === "sftp" ? `${sb.host}:${sb.port}` : sb.type === "aws-s3" ? sb.bucket : "\u2014"}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-400">{sb.basePath}</td>
                  <td className="px-3 py-3 text-zinc-300">{sb.maxFileSizeMb}</td>
                  <td className="px-3 py-3 text-zinc-300">{sb.sessionTtlMinutes}</td>
                  <td className="px-3 py-3 text-zinc-300">{formatDate(sb.createdAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <TestStorageBackendButton backendId={sb.id} />
                      <DeleteStorageBackendButton backendId={sb.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Urzadzenia
// ---------------------------------------------------------------------------

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function deviceStatus(d: DeviceRegistration): { label: string; color: string; border: string; bg: string } {
  if (!d.lastSeenAt) {
    return { label: "nieznany", color: "text-zinc-500", border: "border-zinc-600/40", bg: "bg-zinc-600/10" };
  }
  const elapsed = Date.now() - new Date(d.lastSeenAt).getTime();
  if (elapsed < ONLINE_THRESHOLD_MS) {
    if (d.lastSyncAt) {
      return { label: "online \u2713", color: "text-emerald-300", border: "border-emerald-500/40", bg: "bg-emerald-500/10" };
    }
    return { label: "online", color: "text-sky-300", border: "border-sky-500/40", bg: "bg-sky-500/10" };
  }
  if (elapsed < 60 * 60 * 1000) {
    return { label: "niedawno", color: "text-yellow-300", border: "border-yellow-500/40", bg: "bg-yellow-500/10" };
  }
  return { label: "offline", color: "text-zinc-500", border: "border-zinc-600/40", bg: "bg-zinc-600/10" };
}

function DevicesSection({ devices }: { devices: DeviceRegistration[] }) {
  const onlineCount = devices.filter((d) => {
    if (!d.lastSeenAt) return false;
    return Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
  }).length;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Zarejestrowane urzadzenia</h2>
        <div className="flex items-center gap-2">
          {onlineCount > 0 && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
              {onlineCount} online
            </span>
          )}
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {devices.length}
          </span>
        </div>
      </div>
      {devices.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak zarejestrowanych urzadzen.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Device ID</th>
                <th className="px-3 py-2">Nazwa</th>
                <th className="px-3 py-2">Grupa</th>
                <th className="px-3 py-2">Fixed master</th>
                <th className="px-3 py-2">Zarejestrowano</th>
                <th className="px-3 py-2">Ostatnio widziano</th>
                <th className="px-3 py-2">Ostatni sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {devices.map((d) => {
                const st = deviceStatus(d);
                return (
                  <tr key={d.deviceId}>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border ${st.border} ${st.bg} px-2 py-0.5 text-[10px] font-medium ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">{d.deviceId.slice(0, 12)}</td>
                    <td className="px-3 py-3 text-zinc-200">{d.deviceName}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{d.groupId.slice(0, 8)}</td>
                    <td className="px-3 py-3 text-zinc-300">
                      {d.isFixedMaster ? (
                        <span className="inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">master</span>
                      ) : "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(d.registeredAt)}</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(d.lastSeenAt)}</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(d.lastSyncAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Historia synchronizacji
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section: Sync statistics overview
// ---------------------------------------------------------------------------

function SyncStatsSection({
  sessions,
  devices,
  groups,
  licenses,
}: {
  sessions: SyncSession[];
  devices: DeviceRegistration[];
  groups: ClientGroup[];
  licenses: License[];
}) {
  const completed = sessions.filter((s) => s.status === "completed");
  const failed = sessions.filter((s) => s.status === "failed");
  const totalSessions = completed.length + failed.length;
  const successRate = totalSessions > 0 ? Math.round((completed.length / totalSessions) * 100) : 0;

  // Avg duration of completed sessions (ms)
  const durations = completed
    .filter((s) => s.createdAt && s.completedAt)
    .map((s) => new Date(s.completedAt!).getTime() - new Date(s.createdAt).getTime());
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const avgDurationSec = Math.round(avgDurationMs / 1000);

  // Sessions per device (top 5)
  const deviceSyncCounts = new Map<string, number>();
  for (const s of [...completed, ...failed]) {
    deviceSyncCounts.set(s.masterDeviceId, (deviceSyncCounts.get(s.masterDeviceId) ?? 0) + 1);
    if (s.slaveDeviceId) {
      deviceSyncCounts.set(s.slaveDeviceId, (deviceSyncCounts.get(s.slaveDeviceId) ?? 0) + 1);
    }
  }
  const topDevices = [...deviceSyncCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // License usage
  const licenseUsage = licenses.map((l) => {
    const groupsForLicense = groups.filter((g) => g.licenseId === l.id);
    const devicesForLicense = devices.filter((d) =>
      groupsForLicense.some((g) => g.id === d.groupId),
    );
    return {
      key: l.licenseKey.slice(0, 12),
      plan: l.plan,
      deviceCount: devicesForLicense.length,
      maxDevices: l.maxDevices,
    };
  });

  const statCards = [
    { label: "Sesje ogolnie", value: totalSessions.toString(), sub: `${completed.length} ok / ${failed.length} blad` },
    { label: "Skutecznosc", value: `${successRate}%`, sub: totalSessions > 0 ? `z ${totalSessions} sesji` : "brak danych" },
    { label: "Sredni czas sync", value: avgDurationSec > 60 ? `${Math.round(avgDurationSec / 60)}m ${avgDurationSec % 60}s` : `${avgDurationSec}s`, sub: `z ${durations.length} sesji` },
    { label: "Aktywne urz.", value: devices.length.toString(), sub: `w ${groups.length} grupach` },
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <h2 className="text-sm font-medium text-zinc-200 mb-4">Statystyki synchronizacji</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-xs text-zinc-500">{card.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{card.value}</p>
            <p className="text-xs text-zinc-500">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Top devices */}
        {topDevices.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">Najaktywniejsze urzadzenia</h3>
            <div className="space-y-1.5">
              {topDevices.map(([deviceId, count]) => {
                const device = devices.find((d) => d.deviceId === deviceId);
                return (
                  <div key={deviceId} className="flex items-center justify-between rounded border border-zinc-800 px-2.5 py-1.5 text-xs">
                    <span className="font-mono text-zinc-300 truncate max-w-[180px]">
                      {device?.deviceName || deviceId.slice(0, 16)}
                    </span>
                    <span className="text-zinc-400">{count} sync</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* License usage */}
        {licenseUsage.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">Uzycie licencji</h3>
            <div className="space-y-1.5">
              {licenseUsage.map((lu) => {
                const pct = lu.maxDevices > 0 ? Math.round((lu.deviceCount / lu.maxDevices) * 100) : 0;
                return (
                  <div key={lu.key} className="rounded border border-zinc-800 px-2.5 py-1.5">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono text-zinc-300">{lu.key}&hellip; <span className="text-zinc-500">({lu.plan})</span></span>
                      <span className="text-zinc-400">{lu.deviceCount}/{lu.maxDevices} urz.</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct > 90 ? "bg-amber-500" : "bg-sky-500"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SyncHistorySection({ sessions }: { sessions: SyncSession[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Historia synchronizacji</h2>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          ostatnie {sessions.length}
        </span>
      </div>
      {sessions.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak zakonconych sesji.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Tryb</th>
                <th className="px-3 py-2">Master</th>
                <th className="px-3 py-2">Slave</th>
                <th className="px-3 py-2">Krok</th>
                <th className="px-3 py-2">Utworzona</th>
                <th className="px-3 py-2">Zakonczona</th>
                <th className="px-3 py-2">Blad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {sessions.map((session) => {
                const sBadge = sessionStatusBadge(session.status);
                return (
                  <tr key={session.id}>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">{session.id.slice(0, 8)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${sBadge.className}`}>
                        {sBadge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{session.syncMode ?? "\u2014"}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{session.masterDeviceId.slice(0, 12)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                      {session.slaveDeviceId ? session.slaveDeviceId.slice(0, 12) : "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-zinc-300">{session.currentStep}/13</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(session.createdAt)}</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(session.completedAt)}</td>
                    <td className="px-3 py-3 text-xs text-rose-300 max-w-[200px] truncate">
                      {session.errorMessage ?? "\u2014"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Direct Sync History
// ---------------------------------------------------------------------------

function actionBadge(action: DirectSyncHistoryEntry["action"]) {
  switch (action) {
    case "push":
      return { label: "PUSH", className: "border-blue-500/30 bg-blue-500/10 text-blue-300" };
    case "delta-push":
      return { label: "DELTA", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" };
    case "pull":
      return { label: "PULL", className: "border-purple-500/30 bg-purple-500/10 text-purple-300" };
    case "ack":
      return { label: "ACK", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" };
    case "test":
      return { label: "TEST", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
    default:
      return { label: action.toUpperCase(), className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" };
  }
}

function DirectSyncHistorySection({ entries }: { entries: DirectSyncHistoryEntry[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Historia Direct Sync</h2>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          ostatnie {entries.length}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak wpisow direct sync.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Czas</th>
                <th className="px-3 py-2">Akcja</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Rewizja</th>
                <th className="px-3 py-2">Hash</th>
                <th className="px-3 py-2">Rozmiar</th>
                <th className="px-3 py-2">Szczegoly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {entries.map((entry) => {
                const badge = actionBadge(entry.action);
                return (
                  <tr key={entry.id}>
                    <td className="px-3 py-3 text-xs text-zinc-300 whitespace-nowrap">{formatDate(entry.timestamp)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={entry.status === "ok" ? "text-emerald-400 text-xs" : entry.status === "noop" ? "text-zinc-400 text-xs" : "text-rose-400 text-xs"}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{entry.userId}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{entry.deviceId.slice(0, 12)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">r{entry.revision}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{entry.hash ?? "\u2014"}</td>
                    <td className="px-3 py-3 text-xs text-zinc-400">
                      {entry.sizeBytes != null ? `${(entry.sizeBytes / 1024).toFixed(1)} KB` : "\u2014"}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-400 max-w-[250px] truncate">{entry.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Paczki async delta
// ---------------------------------------------------------------------------

function asyncPackageStatusBadge(status: AsyncPackageStatus): { label: string; className: string } {
  switch (status) {
    case "pending":
      return { label: "Oczekuje", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
    case "delivered":
      return { label: "Dostarczona", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    case "rejected":
      return { label: "Odrzucona", className: "border-rose-500/40 bg-rose-500/10 text-rose-200" };
    case "expired":
      return { label: "Wygasla", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
    default:
      return { label: status, className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" };
  }
}

function AsyncPackagesSection({ packages }: { packages: AsyncDeltaPackage[] }) {
  const pending = packages.filter((p) => p.status === "pending");
  const recent = packages
    .filter((p) => p.status !== "pending")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20);
  const all = [...pending, ...recent];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Paczki async delta</h2>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
            {pending.length} oczekujacych
          </span>
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-400">
            {packages.length} razem
          </span>
        </div>
      </div>
      {all.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Brak paczek async delta.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Od</th>
                <th className="px-3 py-2">Grupa</th>
                <th className="px-3 py-2">Base marker</th>
                <th className="px-3 py-2">New marker</th>
                <th className="px-3 py-2">Rozmiar</th>
                <th className="px-3 py-2">Utworzona</th>
                <th className="px-3 py-2">Wygasa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {all.map((pkg) => {
                const badge = asyncPackageStatusBadge(pkg.status);
                const isExpired = new Date(pkg.expiresAt).getTime() < Date.now();
                const sizeMb = (pkg.fileSizeBytes / (1024 * 1024)).toFixed(2);
                return (
                  <tr key={pkg.id}>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-200">{pkg.id.slice(0, 8)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{pkg.fromDeviceId.slice(0, 10)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{pkg.groupId.slice(0, 8)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{pkg.baseMarkerHash ? pkg.baseMarkerHash.slice(0, 10) : "\u2014"}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-300">{pkg.newMarkerHash.slice(0, 10)}</td>
                    <td className="px-3 py-3 text-zinc-300">{sizeMb} MB</td>
                    <td className="px-3 py-3 text-zinc-300">{formatDate(pkg.createdAt)}</td>
                    <td className={`px-3 py-3 ${isExpired ? "text-rose-300" : "text-zinc-300"}`}>
                      {formatDate(pkg.expiresAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard (main view)
// ---------------------------------------------------------------------------

function DashboardView({
  userId,
  data,
  sftpHealth,
}: {
  userId: string;
  data: DashboardData;
  sftpHealth: SftpHealthStatus;
}) {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                TimeFlow Sync Server
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Panel synchronizacji
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Zalogowano jako:{" "}
                <span className="font-medium text-zinc-200">{userId}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Summary badges */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300">
                  {data.licenses.length} lic
                </span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300">
                  {data.devices.length} dev
                </span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300">
                  {data.activeSessions.length} aktywne
                </span>
              </div>
              <div className={`rounded-xl border px-4 py-2 text-sm ${
                sftpHealth.available
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}>
                {sftpHealth.available ? "Storage online" : "Storage offline"}
              </div>
              <form action="/auth/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 hover:border-zinc-600"
                >
                  Wyloguj
                </button>
              </form>
            </div>
          </div>
        </header>

        <SyncStatsSection sessions={data.sessions} devices={data.devices} groups={data.groups} licenses={data.licenses} />
        <ActiveSessionsSection sessions={data.activeSessions} />
        <LicensesSection licenses={data.licenses} groups={data.groups} />
        <GroupsSection groups={data.groups} storageBackends={data.storageBackends} licenses={data.licenses} />
        <StorageBackendsSection storageBackends={data.storageBackends} />
        <DevicesSection devices={data.devices} />
        <AsyncPackagesSection packages={data.asyncPackages} />
        <SyncHistorySection sessions={data.completedSessions} />
        <DirectSyncHistorySection entries={data.directSyncHistory} />

        <footer className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
          <div className="flex items-center justify-between">
            <span>Uptime servera: {formatUptime(process.uptime())}</span>
            <span>SFTP sprawdzenie: {formatDate(sftpHealth.lastCheckAt)}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

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

    const [data, sftpHealth] = await Promise.all([
      getDashboardData(),
      healthCheck(),
    ]);

    return (
      <DashboardView
        userId={loggedUserId}
        data={data}
        sftpHealth={sftpHealth}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <div className="w-full max-w-2xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-rose-300">TimeFlow Sync Server</p>
          <h1 className="mt-2 text-xl font-semibold">Blad odczytu statusu</h1>
          <p className="mt-3 text-sm text-rose-100/90">{message}</p>
        </div>
      </main>
    );
  }
}
