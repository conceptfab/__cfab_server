"use client";

import { useReducer, useRef, useState } from "react";

import { DashboardDrawer } from "@/components/dashboard/dashboard-drawer";

// ---------------------------------------------------------------------------
// CreateLicenseForm
// ---------------------------------------------------------------------------

interface CreateLicenseFormProps {
  groups: { id: string; name: string }[];
}

interface CreateResult {
  ok: boolean;
  licenseKey?: string;
  plan?: string;
  groupName?: string;
  error?: string;
}

interface LicenseFormState {
  plan: string;
  maxDevices: number;
  groupMode: "existing" | "new";
  groupId: string;
  groupName: string;
}

type LicenseFormAction = {
  [Key in keyof LicenseFormState]: {
    field: Key;
    value: LicenseFormState[Key];
  };
}[keyof LicenseFormState];

function licenseFormReducer(
  state: LicenseFormState,
  action: LicenseFormAction,
): LicenseFormState {
  return { ...state, [action.field]: action.value };
}

export function CreateLicenseForm({ groups }: CreateLicenseFormProps) {
  const [form, updateForm] = useReducer(licenseFormReducer, {
    plan: "pro",
    maxDevices: 5,
    groupMode: groups.length > 0 ? "existing" : "new",
    groupId: groups[0]?.id ?? "",
    groupName: "",
  });
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Prevent double-submit
    if (submittingRef.current) return;
    submittingRef.current = true;

    setCreating(true);
    setResult(null);
    setCopied(false);

    try {
      const body: Record<string, unknown> = {
        plan: form.plan,
        maxDevices: form.maxDevices,
      };
      if (form.groupMode === "existing" && form.groupId) {
        body.groupId = form.groupId;
      } else if (form.groupMode === "new" && form.groupName.trim()) {
        body.groupName = form.groupName.trim();
      }

      const res = await fetch("/api/admin/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok && json.license) {
        const gName =
          form.groupMode === "new"
            ? form.groupName.trim()
            : groups.find((g) => g.id === form.groupId)?.name ?? form.groupId;
        setResult({
          ok: true,
          licenseKey: json.license.licenseKey,
          plan: json.license.plan,
          groupName: gName,
        });
      } else {
        setResult({
          ok: false,
          error: json.error || json.message || "Nie udalo sie utworzyc licencji",
        });
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
      submittingRef.current = false;
    }
  }

  async function handleCopy() {
    if (!result?.licenseKey) return;
    try {
      await navigator.clipboard.writeText(result.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = result.licenseKey;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <DashboardDrawer title="Nowa licencja" triggerLabel="Nowa licencja">
    <div className="dashboard-form">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Nowa licencja
      </h3>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        {/* Plan */}
        <label className="grid gap-1 text-xs text-zinc-400">
          Plan
          <select
              value={form.plan}
              onChange={(e) => updateForm({ field: "plan", value: e.target.value })}
            className="h-9 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
          >
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>

        {/* Max devices */}
        <label className="grid gap-1 text-xs text-zinc-400">
          Max urzadzen
          <input
            type="number"
            min={1}
            max={9999}
            value={form.maxDevices}
            onChange={(e) => updateForm({ field: "maxDevices", value: Number(e.target.value) || 1 })}
            className="h-9 w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
          />
        </label>

        {/* Group */}
        <label className="grid gap-1 text-xs text-zinc-400">
          Grupa
          <div className="flex items-center gap-2">
            <select
              value={form.groupMode}
              onChange={(e) => updateForm({ field: "groupMode", value: e.target.value as "existing" | "new" })}
              className="h-9 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
            >
              {groups.length > 0 && <option value="existing">Istniejaca</option>}
              <option value="new">Nowa</option>
            </select>

            {form.groupMode === "existing" && groups.length > 0 ? (
              <select
                value={form.groupId}
                onChange={(e) => updateForm({ field: "groupId", value: e.target.value })}
                className="h-9 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.groupName}
                onChange={(e) => updateForm({ field: "groupName", value: e.target.value })}
                placeholder="Nazwa grupy..."
                className="h-9 w-40 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
            )}
          </div>
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={creating}
          className="h-9 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {creating ? "Tworzenie..." : "Utworz licencje"}
        </button>
      </form>

      {/* Result */}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
          {result.error}
        </div>
      )}

      {result?.ok && result.licenseKey && (
        <output className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="text-xs text-emerald-300">
            Licencja utworzona ({result.plan?.toUpperCase()}, grupa: {result.groupName})
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 select-all rounded-md border border-emerald-500/20 bg-zinc-900 px-3 py-2 font-mono text-sm text-emerald-200">
              {result.licenseKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="h-9 rounded-md border border-zinc-600 bg-zinc-800 px-3 text-sm text-zinc-200 transition hover:border-zinc-500"
            >
              {copied ? "Skopiowano!" : "Kopiuj"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Przekaz ten klucz uzytkownikowi. Wkleja go w TIMEFLOW → Ustawienia → Online Sync → Licencja → Aktywuj.
          </p>
        </output>
      )}
    </div>
    </DashboardDrawer>
  );
}

// ---------------------------------------------------------------------------
// DeleteLicenseButton
// ---------------------------------------------------------------------------

interface DeleteLicenseButtonProps {
  licenseId: string;
}

export function DeleteLicenseButton({ licenseId }: DeleteLicenseButtonProps) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Na pewno usunac te licencje? Operacja jest nieodwracalna.")) return;
    if (deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/license/${licenseId}`, {
        method: "DELETE",
      });
      const json = await res.json();

      if (json.ok && json.deleted) {
        window.location.reload();
      } else {
        alert(json.error || "Nie udalo sie usunac licencji");
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
