"use client";

import { useState } from "react";

export function ClearSyncSessionsButton() {
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    if (!confirm("Na pewno wyczyścić wszystkie sesje synchronizacji?")) return;
    if (clearing) return;

    setClearing(true);
    try {
      const res = await fetch("/api/admin/sync-sessions", { method: "DELETE" });
      const json = await res.json();

      if (json.ok) {
        window.location.reload();
      } else {
        alert(json.error || "Nie udało się wyczyścić sesji");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClear}
      disabled={clearing}
      className="inline-flex items-center rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
    >
      {clearing ? "Czyszczenie..." : "Wyczyść sesje"}
    </button>
  );
}
