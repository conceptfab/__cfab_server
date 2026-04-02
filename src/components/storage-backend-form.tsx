"use client";

import { useState, useRef } from "react";

// ---------------------------------------------------------------------------
// CreateStorageBackendForm - formularz dodawania serwera SFTP/S3
// ---------------------------------------------------------------------------

export function CreateStorageBackendForm() {
  const [type, setType] = useState<"sftp" | "ftp" | "aws-s3">("ftp");
  const [name, setName] = useState("");
  const [basePath, setBasePath] = useState("/timeflow-sync/");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(21);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      const body: Record<string, unknown> = { type, name, basePath };
      if (type === "sftp") {
        body.host = host;
        body.port = port;
        body.username = username;
        body.password = password;
      }

      const res = await fetch("/api/admin/storage-backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setResult({ ok: true, name });
        setName("");
        setHost("");
        setUsername("");
        setPassword("");
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
    <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-800/50 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Nowy storage backend
      </h3>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-zinc-400">
            Typ
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "sftp" | "ftp" | "aws-s3")}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Serwer produkcyjny"
              required
              className="h-9 w-44 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
          </label>

          <label className="grid gap-1 text-xs text-zinc-400">
            Base path
            <input
              type="text"
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
              required
              className="h-9 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
            />
          </label>
        </div>

        {(type === "sftp" || type === "ftp") && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-zinc-400">
              Host
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="ftp.example.com"
                required
                className="h-9 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Port
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || (type === "ftp" ? 21 : 22))}
                min={1}
                max={65535}
                className="h-9 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Uzytkownik
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-9 w-32 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              />
            </label>

            <label className="grid gap-1 text-xs text-zinc-400">
              Haslo
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {result.error}
        </div>
      )}
      {result?.ok && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Backend &quot;{result.name}&quot; utworzony. Odswiezanie...
        </div>
      )}
    </div>
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

  function statusIcon(ok: boolean) {
    return ok ? "✓" : "✗";
  }

  function statusColor(ok: boolean) {
    return ok ? "text-emerald-300" : "text-rose-300";
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
