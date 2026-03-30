import { cookies } from "next/headers";

import { ResetSyncButton } from "@/components/reset-sync-button";
import { SyncStatusLoginForm } from "@/components/sync-status-login-form";
import {
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  SYNC_DASHBOARD_AUTH_COOKIE,
  getDashboardUserIdFromCookie,
} from "@/lib/auth/dashboard-page-auth";
import { getEnv } from "@/lib/config/env";
import {
  getSyncDashboardSummary,
  type SyncDashboardUserSummary,
  type SyncDeliveryStatus,
} from "@/lib/sync/repository";
import type { SyncSession, SyncSessionStatus } from "@/lib/sync/session-contracts";
import { getAllSessions } from "@/lib/sync/session-store";
import { healthCheck, type SftpHealthStatus } from "@/lib/sync/sftp-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

interface HomePageProps {
  searchParams?: SearchParamsRecord | Promise<SearchParamsRecord>;
}

function statusBadge(status: SyncDeliveryStatus): { label: string; className: string } {
  switch (status) {
    case "up_to_date":
      return {
        label: "Odebrane / aktualne",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      };
    case "pending":
      return {
        label: "Brak potwierdzenia",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      };
    default:
      return {
        label: "Status nieznany",
        className: "border-slate-500/40 bg-slate-500/10 text-slate-300",
      };
  }
}

function shortHash(hash: string | null): string {
  if (!hash) return "n/a";
  return `${hash.slice(0, 12)}...`;
}

function formatDate(value: string | null): string {
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

function UserStatusView({
  userId,
  user,
  generatedAt,
  storeFile,
  dataDir,
  resetState,
  sessions,
  sftpHealth,
}: {
  userId: string;
  user: SyncDashboardUserSummary | null;
  generatedAt: string;
  storeFile: string;
  dataDir: string;
  resetState: string | null;
  sessions: SyncSession[];
  sftpHealth: SftpHealthStatus;
}) {
  const hasResettableData = user !== null && (user.snapshotCount > 0 || user.deviceCount > 0);

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
                Status synchronizacji
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Widok tylko dla konta:{" "}
                <span className="font-medium text-zinc-200">{userId}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
                API online
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
          <p className="mt-4 text-xs text-zinc-500">
            Ostatnia aktualizacja widoku: {formatDate(generatedAt)}
          </p>
        </header>

        {resetState === "done" ? (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            Historia sync dla konta zostala wyczyszczona. Kolejny `push`/`pull` zacznie od zera.
          </section>
        ) : null}

        {resetState === "error" ? (
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            Nie udalo sie wyczyscic historii sync. Sprobuj ponownie.
          </section>
        ) : null}

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="text-sm font-medium text-zinc-200">Jak czytac statusy</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Brak potwierdzenia oznacza, ze serwer nie ma jawnego `ack` odbioru
            najnowszego snapshotu dla danego urzadzenia. Po udanym `pull` klient powinien
            wyslac `ack`. Status `Odebrane / aktualne` oznacza jawny `ack` (albo urzadzenie,
            ktore utworzylo snapshot przez `push`). Po potwierdzeniu przez wszystkie znane
            urzadzenia docelowe payload jest usuwany z serwera.
          </p>
        </section>

        {!user ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-300">
            <p className="text-lg font-medium">Brak snapshotow dla tego konta</p>
            <p className="mt-2 text-sm text-zinc-400">
              Wykonaj sync z dashboardu (`Sync now`), a status pojawi sie tutaj.
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <p className="text-xs text-zinc-400">Dane przeslane (snapshoty)</p>
                <p className="mt-1 text-2xl font-semibold">{user.snapshotCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <p className="text-xs text-zinc-400">Urzadzenia</p>
                <p className="mt-1 text-2xl font-semibold">{user.deviceCount}</p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-zinc-900/70 p-4">
                <p className="text-xs text-zinc-400">Czekaja na pobranie</p>
                <p className="mt-1 text-2xl font-semibold text-amber-200">
                  {user.pendingDevices}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-zinc-900/70 p-4">
                <p className="text-xs text-zinc-400">Odebrane / aktualne</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-300">
                  {user.upToDateDevices}
                </p>
              </div>
              <div className="rounded-xl border border-slate-500/20 bg-zinc-900/70 p-4">
                <p className="text-xs text-zinc-400">Status nieznany</p>
                <p className="mt-1 text-2xl font-semibold text-slate-200">
                  {user.unknownDevices}
                </p>
              </div>
            </section>

            <article className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Konto</p>
                  <h3 className="mt-1 break-all text-lg font-semibold">{user.userId}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-zinc-800 px-3 py-2">
                    <div className="text-zinc-500">Rev</div>
                    <div className="font-mono text-zinc-100">{user.latestRevision ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 px-3 py-2">
                    <div className="text-zinc-500">Hash</div>
                    <div className="font-mono text-zinc-100">{shortHash(user.latestHash)}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 px-3 py-2">
                    <div className="text-zinc-500">Snapshoty</div>
                    <div className="text-zinc-100">{user.snapshotCount}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 px-3 py-2">
                    <div className="text-zinc-500">Urzadzenia</div>
                    <div className="text-zinc-100">{user.deviceCount}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
                <div>
                  Ostatni snapshot:{" "}
                  <span className="text-zinc-200">{formatDate(user.latestReceivedAt)}</span>
                </div>
                <div>
                  Zrodlo snapshotu:{" "}
                  <span className="break-all text-zinc-200">
                    {user.latestSourceDeviceId ?? "brak"}
                  </span>
                </div>
                <div>
                  Payload na serwerze:{" "}
                  <span
                    className={
                      user.latestArchiveAvailable ? "text-emerald-300" : "text-amber-200"
                    }
                  >
                    {user.latestArchiveAvailable ? "jest" : "usuniety"}
                  </span>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Urzadzenie</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last Seen</th>
                      <th className="px-3 py-2">Client Rev</th>
                      <th className="px-3 py-2">Client Hash</th>
                      <th className="px-3 py-2">ACK Rev</th>
                      <th className="px-3 py-2">ACK At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {user.devices.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-zinc-500" colSpan={7}>
                          Brak urzadzen dla tego konta.
                        </td>
                      </tr>
                    ) : (
                      user.devices.map((device) => {
                        const badge = statusBadge(device.status);
                        return (
                          <tr key={device.deviceId}>
                            <td className="px-3 py-3 font-mono text-xs text-zinc-200">
                              <span className="break-all">{device.deviceId}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-zinc-300">
                              {formatDate(device.lastSeenAt)}
                            </td>
                            <td className="px-3 py-3 font-mono text-zinc-200">
                              {device.lastClientRevision ?? "n/a"}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                              {shortHash(device.lastClientHash)}
                            </td>
                            <td className="px-3 py-3 font-mono text-zinc-200">
                              {device.lastAckRevision ?? "n/a"}
                            </td>
                            <td className="px-3 py-3 text-zinc-300">
                              {formatDate(device.lastAckAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </>
        )}

        {/* --- Aktywne sesje sync (Online) --- */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="text-sm font-medium text-zinc-200">Aktywne sesje sync (Online)</h2>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">Brak aktywnych sesji online sync.</p>
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
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${sBadge.className}`}
                          >
                            {sBadge.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                          {session.masterDeviceId.slice(0, 12)}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-zinc-300">
                          {session.slaveDeviceId ? session.slaveDeviceId.slice(0, 12) : "—"}
                        </td>
                        <td className="px-3 py-3 text-zinc-300">
                          {session.syncMode ?? "—"}
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
            </div>
          )}
        </section>

        {/* --- Konfiguracja SFTP --- */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="text-sm font-medium text-zinc-200">Konfiguracja SFTP</h2>
          <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
            <div>
              SFTP Host:{" "}
              <span className="text-zinc-200">{getEnv().sftpHost ?? "nie skonfigurowano"}</span>
            </div>
            <div>
              SFTP Port:{" "}
              <span className="text-zinc-200">{getEnv().sftpPort}</span>
            </div>
            <div>
              SFTP User:{" "}
              <span className="text-zinc-200">{getEnv().sftpUser ?? "—"}</span>
            </div>
            <div>
              SFTP Base Path:{" "}
              <span className="text-zinc-200">{getEnv().sftpBasePath}</span>
            </div>
            <div>
              Max rozmiar pliku:{" "}
              <span className="text-zinc-200">{getEnv().sftpMaxFileSizeMb} MB</span>
            </div>
            <div>
              Klucz szyfrowania:{" "}
              {getEnv().syncEncryptionKey ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
                  skonfigurowany
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-200">
                  brak
                </span>
              )}
            </div>
            <div>
              Status:{" "}
              {sftpHealth.available ? (
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
                  Polaczony
                </span>
              ) : sftpHealth.error === "SFTP not configured" ? (
                <span className="inline-flex items-center rounded-full border border-zinc-500/40 bg-zinc-500/10 px-2.5 py-0.5 text-xs text-zinc-300">
                  Nie skonfigurowano
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-200">
                  Niedostepny
                </span>
              )}
            </div>
            <div>
              Aktywne sesje na SFTP:{" "}
              <span className="text-zinc-200">{sftpHealth.activeSessions}</span>
            </div>
            <div>
              Ostatnie sprawdzenie:{" "}
              <span className="text-zinc-200">{formatDate(sftpHealth.lastCheckAt)}</span>
            </div>
            {sftpHealth.error && sftpHealth.error !== "SFTP not configured" ? (
              <div className="sm:col-span-2">
                Blad:{" "}
                <span className="text-rose-300">{sftpHealth.error}</span>
              </div>
            ) : null}
          </div>
        </section>

        {/* --- Licencje (placeholder) --- */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-zinc-200">Licencje i grupy klientow</h2>
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              Wkrotce
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Zarzadzanie licencjami, planami (free/starter/pro/enterprise), grupami klientow
            i przypisaniem urzadzen. Funkcja zostanie dodana w kolejnej fazie wdrozenia.
          </p>
        </section>

        <section className="rounded-2xl border border-rose-500/30 bg-zinc-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h2 className="text-sm font-medium text-rose-200">Reset historii sync</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Ta operacja usuwa wszystkie snapshoty, revision, `ack` oraz historie urzadzen
                zapisane na serwerze dla konta{" "}
                <span className="font-medium text-zinc-200">{userId}</span>.
                Nastepna synchronizacja zacznie budowac stan od nowa.
              </p>
              {!hasResettableData ? (
                <p className="mt-3 text-sm text-zinc-500">
                  Brak zapisanych danych sync do usuniecia.
                </p>
              ) : null}
            </div>
            <ResetSyncButton disabled={!hasResettableData} />
          </div>
        </section>

        <footer className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
          <div>Store: {storeFile}</div>
          <div>Data dir: {dataDir}</div>
          <div>Uptime servera: {formatUptime(process.uptime())}</div>
          <div>Cookie sesji: 7 dni (httpOnly)</div>
        </footer>
      </div>
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
    const resetState = getFirstQueryValue(resolvedSearchParams.reset);

    if (!loggedUserId) {
      return <LoginView authState={authState} />;
    }

    const [summary, sessions, sftpHealth] = await Promise.all([
      getSyncDashboardSummary(),
      getAllSessions(),
      healthCheck(),
    ]);
    const user = summary.users.find((entry) => entry.userId === loggedUserId) ?? null;

    return (
      <UserStatusView
        userId={loggedUserId}
        user={user}
        generatedAt={summary.generatedAt}
        storeFile={summary.storeFile}
        dataDir={summary.dataDir}
        resetState={resetState}
        sessions={sessions}
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

