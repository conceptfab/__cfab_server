"use client";

import { useState, useTransition } from "react";

import { DashboardDrawer } from "@/components/dashboard/dashboard-drawer";

interface CreateGroupFormProps {
  licenses: { id: string; licenseKey: string; plan: string }[];
  storageBackends: { id: string; name: string; type: string }[];
}

export function CreateGroupForm({ licenses, storageBackends }: CreateGroupFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/group", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"),
            ownerId: fd.get("ownerId") || "admin",
            licenseId: fd.get("licenseId"),
            storageBackendId: fd.get("storageBackendId") || undefined,
            fixedMasterDeviceId: fd.get("fixedMasterDeviceId") || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <DashboardDrawer title="Nowa grupa" triggerLabel="Nowa grupa">
    <form onSubmit={handleSubmit} className="dashboard-form space-y-3">
      {error && (
        <p className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded px-2 py-1" role="alert">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-zinc-400">Nazwa grupy</span>
          <input name="name" required className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200" />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400">Owner ID</span>
          <input name="ownerId" defaultValue="admin" className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-zinc-400">Licencja</span>
          <select name="licenseId" required className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200">
            <option value="">-- wybierz --</option>
            {licenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.licenseKey.slice(0, 12)}&hellip; ({l.plan})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400">Storage backend</span>
          <select name="storageBackendId" className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200">
            <option value="">-- brak (globalne env) --</option>
            {storageBackends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.type})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-zinc-400">Fixed Master Device ID (opcjonalnie)</span>
        <input name="fixedMasterDeviceId" className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-50 transition-colors">
          {pending ? "Tworzenie..." : "Utworz grupe"}
        </button>
        <button type="button" onClick={(event) => event.currentTarget.closest("dialog")?.close()}
          className="rounded-lg border border-zinc-600 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors">
          Anuluj
        </button>
      </div>
    </form>
    </DashboardDrawer>
  );
}
