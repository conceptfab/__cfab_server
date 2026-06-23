"use client";

import { useReducer, useRef, useState } from "react";

import { DashboardDrawer } from "@/components/dashboard/dashboard-drawer";

type StorageKind = "sftp" | "ftp" | "aws-s3";

interface CreateStorageFormState {
  type: StorageKind;
  name: string;
  basePath: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

type CreateStorageFormAction =
  | {
      [Key in keyof CreateStorageFormState]: {
        field: Key;
        value: CreateStorageFormState[Key];
      };
    }[keyof CreateStorageFormState]
  | { reset: true };

const INITIAL_CREATE_STORAGE_FORM: CreateStorageFormState = {
  type: "ftp",
  name: "",
  basePath: "/timeflow-sync/",
  host: "",
  port: 21,
  username: "",
  password: "",
};

function createStorageFormReducer(
  state: CreateStorageFormState,
  action: CreateStorageFormAction,
): CreateStorageFormState {
  if ("reset" in action) return INITIAL_CREATE_STORAGE_FORM;
  return { ...state, [action.field]: action.value };
}

// ---------------------------------------------------------------------------
// CreateStorageBackendForm - formularz dodawania serwera SFTP/S3
// ---------------------------------------------------------------------------

export function CreateStorageBackendForm() {
  const [form, updateForm] = useReducer(
    createStorageFormReducer,
    INITIAL_CREATE_STORAGE_FORM,
  );
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; name?: string } | null>(null);
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setCreating(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        type: form.type,
        name: form.name,
        basePath: form.basePath,
      };
      if (form.type === "sftp" || form.type === "ftp") {
        body.host = form.host;
        body.port = form.port;
        body.username = form.username;
        body.password = form.password;
      }

      const res = await fetch("/api/admin/storage-backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setResult({ ok: true, name: form.name });
        updateForm({ reset: true });
        setTimeout(() => window.location.reload(), 1000);
      } else {
        setResult({ ok: false, error: json.error || "Nie udalo sie utworzyc backendu" });
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
      submittingRef.current = false;
    }
  }

  return (
    <DashboardDrawer title="Nowy backend storage" triggerLabel="Nowy backend">
    <div className="dashboard-form">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Nowy storage backend
      </h3>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-zinc-400">
            Typ
            <select
              value={form.type}
              onChange={(e) => updateForm({ field: "type", value: e.target.value as StorageKind })}
              className="h-9 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
            >
              <option value="ftp">FTP</option>
              <option value="sftp">SFTP</option>
              <option value="aws-s3">AWS S3</option>
            </select>
          </label>

          <label className="grid gap-1 text-xs text-zinc-400">
            Nazwa
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateForm({ field: "name", value: e.target.value })}
              placeholder="np. Serwer produkcyjny"
              required
              className="h-9 w-44 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </label>

          <label className="grid gap-1 text-xs text-zinc-400">
            Base path
            <input
              type="text"
              value={form.basePath}
              onChange={(e) => updateForm({ field: "basePath", value: e.target.value })}
              required
              className="h-9 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
            />
          </label>
        </div>

        {(form.type === "sftp" || form.type === "ftp") && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-zinc-400">
              Host
              <input
                type="text"
                value={form.host}
                onChange={(e) => updateForm({ field: "host", value: e.target.value })}
                placeholder="ftp.example.com"
                required
                className="h-9 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Port
              <input
                type="number"
                value={form.port}
                onChange={(e) => updateForm({ field: "port", value: Number(e.target.value) || (form.type === "ftp" ? 21 : 22) })}
                min={1}
                max={65535}
                className="h-9 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Uzytkownik
              <input
                type="text"
                value={form.username}
                onChange={(e) => updateForm({ field: "username", value: e.target.value })}
                required
                className="h-9 w-32 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Haslo
              <input
                type="password"
                value={form.password}
                onChange={(e) => updateForm({ field: "password", value: e.target.value })}
                required
                className="h-9 w-32 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              />
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={creating}
          className="h-9 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {creating ? "Tworzenie..." : "Dodaj backend"}
        </button>
      </form>

      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
          {result.error}
        </div>
      )}
      {result?.ok && (
        <output className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Backend &quot;{result.name}&quot; utworzony. Odswiezanie...
        </output>
      )}
    </div>
    </DashboardDrawer>
  );
}

// ---------------------------------------------------------------------------
// GroupBackendSelector - dropdown do zmiany backendu grupy
// ---------------------------------------------------------------------------

interface GroupBackendSelectorProps {
  groupId: string;
  currentBackendId: string;
  backends: { id: string; name: string }[];
}

export function GroupBackendSelector({ groupId, currentBackendId, backends }: GroupBackendSelectorProps) {
  const [saving, setSaving] = useState(false);

  async function handleChange(newBackendId: string) {
    if (newBackendId === currentBackendId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/group/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageBackendId: newBackendId }),
      });
      const json = await res.json();

      if (json.ok) {
        window.location.reload();
      } else {
        alert(json.error || "Nie udalo sie zmienic backendu");
        setSaving(false);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <select
      value={currentBackendId}
      onChange={(e) => handleChange(e.target.value)}
      disabled={saving}
      className="h-7 rounded border border-zinc-600 bg-zinc-900 px-1.5 text-xs text-zinc-100 disabled:opacity-50"
    >
      <option value="default">domyslny (env)</option>
      {backends.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// DeleteStorageBackendButton
// ---------------------------------------------------------------------------

interface DeleteStorageBackendButtonProps {
  backendId: string;
}

export function DeleteStorageBackendButton({ backendId }: DeleteStorageBackendButtonProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Na pewno usunac ten storage backend?")) return;
    if (deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/storage-backend/${backendId}`, {
        method: "DELETE",
      });
      const json = await res.json();

      if (json.ok && json.deleted) {
        window.location.reload();
      } else {
        alert(json.error || "Nie udalo sie usunac backendu");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
    >
      {deleting ? "..." : "Usun"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// EditStorageBackendButton - inline edit with modal-like dropdown
// ---------------------------------------------------------------------------

interface EditStorageBackendButtonProps {
  backendId: string;
  current: {
    name: string;
    basePath: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    maxFileSizeMb: number;
    sessionTtlMinutes: number;
    type: string;
  };
}

interface EditStorageFormState {
  name: string;
  basePath: string;
  host: string;
  port: number;
  username: string;
  password: string;
  maxFileSizeMb: number;
  sessionTtlMinutes: number;
}

type EditStorageFormAction = {
  [Key in keyof EditStorageFormState]: {
    field: Key;
    value: EditStorageFormState[Key];
  };
}[keyof EditStorageFormState];

function editStorageFormReducer(
  state: EditStorageFormState,
  action: EditStorageFormAction,
): EditStorageFormState {
  return { ...state, [action.field]: action.value };
}

function createEditStorageFormState(
  current: EditStorageBackendButtonProps["current"],
): EditStorageFormState {
  return {
    name: current.name,
    basePath: current.basePath,
    host: current.host ?? "",
    port: current.port ?? 21,
    username: current.username ?? "",
    password: "",
    maxFileSizeMb: current.maxFileSizeMb,
    sessionTtlMinutes: current.sessionTtlMinutes,
  };
}

export function EditStorageBackendButton({ backendId, current }: EditStorageBackendButtonProps) {
  const [form, updateForm] = useReducer(
    editStorageFormReducer,
    current,
    createEditStorageFormState,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name: form.name,
        basePath: form.basePath,
        maxFileSizeMb: form.maxFileSizeMb,
        sessionTtlMinutes: form.sessionTtlMinutes,
      };
      if (current.type === "sftp" || current.type === "ftp") {
        body.host = form.host;
        body.port = form.port;
        body.username = form.username;
        if (form.password) body.password = form.password;
      }

      const res = await fetch(`/api/admin/storage-backend/${backendId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        window.location.reload();
      } else {
        setError(json.error || "Nie udalo sie zapisac zmian");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const isFtpLike = current.type === "sftp" || current.type === "ftp";

  return (
    <DashboardDrawer title="Edytuj backend storage" triggerLabel="Edytuj" tone="secondary">
    <div className="dashboard-form space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-zinc-400">
          Nazwa
          <input type="text" value={form.name} onChange={(e) => updateForm({ field: "name", value: e.target.value })}
            className="h-8 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Base path
          <input type="text" value={form.basePath} onChange={(e) => updateForm({ field: "basePath", value: e.target.value })}
            className="h-8 w-52 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Max plik (MB)
          <input type="number" value={form.maxFileSizeMb} onChange={(e) => updateForm({ field: "maxFileSizeMb", value: Number(e.target.value) || 100 })}
            min={1} className="h-8 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          TTL sesji (min)
          <input type="number" value={form.sessionTtlMinutes} onChange={(e) => updateForm({ field: "sessionTtlMinutes", value: Number(e.target.value) || 60 })}
            min={1} className="h-8 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
        </label>
      </div>

      {isFtpLike && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-zinc-400">
            Host
            <input type="text" value={form.host} onChange={(e) => updateForm({ field: "host", value: e.target.value })}
              className="h-8 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Port
            <input type="number" value={form.port} onChange={(e) => updateForm({ field: "port", value: Number(e.target.value) || 21 })}
              min={1} max={65535} className="h-8 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Uzytkownik
            <input type="text" value={form.username} onChange={(e) => updateForm({ field: "username", value: e.target.value })}
              className="h-8 w-32 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Haslo (puste = bez zmian)
            <input type="password" value={form.password} onChange={(e) => updateForm({ field: "password", value: e.target.value })}
              placeholder="••••••••"
              className="h-8 w-32 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-600" />
          </label>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={handleSave} disabled={saving}
          className="h-8 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-3 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
          {saving ? "Zapisywanie..." : "Zapisz"}
        </button>
        <button type="button" onClick={(event) => event.currentTarget.closest("dialog")?.close()}
          className="h-8 rounded-md border border-zinc-600 px-3 text-xs text-zinc-300 hover:bg-zinc-700">
          Anuluj
        </button>
        {error && <span className="text-xs text-rose-300" role="alert">{error}</span>}
      </div>
    </div>
    </DashboardDrawer>
  );
}

// ---------------------------------------------------------------------------
// TestStorageBackendButton - pełny test upload/download
// ---------------------------------------------------------------------------

interface TestResult {
  reachable: boolean;
  uploadOk: boolean;
  downloadOk: boolean;
  matchOk: boolean;
  latencyMs: number;
  error: string | null;
}

function statusIcon(ok: boolean) {
  return ok ? "✓" : "✗";
}

function statusColor(ok: boolean) {
  return ok ? "text-emerald-300" : "text-rose-300";
}

export function TestStorageBackendButton({ backendId }: { backendId: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/storage-backend/${backendId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();

      if (json.ok !== undefined) {
        setResult({
          reachable: json.reachable ?? false,
          uploadOk: json.uploadOk ?? false,
          downloadOk: json.downloadOk ?? false,
          matchOk: json.matchOk ?? false,
          latencyMs: json.latencyMs ?? 0,
          error: json.error ?? null,
        });
      } else {
        setResult({
          reachable: false,
          uploadOk: false,
          downloadOk: false,
          matchOk: false,
          latencyMs: 0,
          error: json.error || "Nieznany blad",
        });
      }
    } catch (err) {
      setResult({
        reachable: false,
        uploadOk: false,
        downloadOk: false,
        matchOk: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="inline-flex items-center rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:opacity-50"
      >
        {testing ? "Testowanie..." : "Testuj"}
      </button>

      {result && (
        <span className="inline-flex items-center gap-1.5 text-[10px]">
          {result.error ? (
            <span className="text-rose-300" title={result.error}>✗ {result.error.slice(0, 40)}</span>
          ) : (
            <>
              <span className={statusColor(result.uploadOk)} title="Upload">{statusIcon(result.uploadOk)} UP</span>
              <span className={statusColor(result.downloadOk)} title="Download">{statusIcon(result.downloadOk)} DL</span>
              <span className={statusColor(result.matchOk)} title="Dane zgodne">{statusIcon(result.matchOk)} OK</span>
              <span className="text-zinc-400">{result.latencyMs}ms</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
