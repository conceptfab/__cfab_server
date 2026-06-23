"use client";

import { useState } from "react";

export function CopyTokenButton({ token }: { token: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <button
      type="button"
      aria-label={`Skopiuj token ${token.slice(0, 8)}`}
      className="dashboard-copy-token"
      title="Skopiuj token"
      onClick={copyToken}
    >
      {copyState === "idle" ? `${token.slice(0, 8)}…` : null}
      {copyState === "copied" ? <output>Skopiowano</output> : null}
      {copyState === "error" ? <span role="alert">Błąd kopiowania</span> : null}
    </button>
  );
}
