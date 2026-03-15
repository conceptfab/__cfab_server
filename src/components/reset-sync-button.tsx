"use client";

import { useState } from "react";

export function ResetSyncButton({
  disabled,
}: {
  disabled: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      action="/reset-sync"
      method="post"
      onSubmit={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }

        const confirmed = window.confirm(
          "To usunie wszystkie snapshoty oraz historie sync/ack dla tego konta. Kontynuowac?",
        );
        if (!confirmed) {
          event.preventDefault();
          return;
        }

        setSubmitting(true);
      }}
    >
      <button
        type="submit"
        disabled={disabled || submitting}
        className="inline-flex h-10 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
      >
        {submitting ? "Resetowanie..." : "Usun snapshoty i historie"}
      </button>
    </form>
  );
}
