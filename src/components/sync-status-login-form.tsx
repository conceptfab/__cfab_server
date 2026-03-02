"use client";

import { useState } from "react";

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 1 0 2.8 2.8" />
      <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-4.2 5.2" />
      <path d="M6.6 6.7A18.2 18.2 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.4-1.2" />
    </svg>
  );
}

export function SyncStatusLoginForm({
  authState,
}: {
  authState: string | null;
}) {
  const [showToken, setShowToken] = useState(false);
  const invalid = authState === "invalid";
  const loggedOut = authState === "logged_out";

  return (
    <>
      {invalid ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Blad.
        </div>
      ) : null}
      {loggedOut ? (
        <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-200">
          Sesja zakonczona.
        </div>
      ) : null}

      <form action="/auth/login" method="post" className="mt-4 space-y-3">
        <label className="grid gap-1.5 text-sm">
          <span className="sr-only">ID</span>
          <input
            type="text"
            name="i"
            required
            autoComplete="off"
            spellCheck={false}
            aria-label="ID"
            placeholder="ID"
            className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="sr-only">Kod</span>
          <div className="flex items-center gap-2">
            <input
              type={showToken ? "text" : "password"}
              name="k"
              required
              autoComplete="off"
              aria-label="Kod"
              placeholder="Kod"
              className="h-10 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => setShowToken((prev) => !prev)}
              aria-label={showToken ? "Ukryj" : "Pokaz"}
              title={showToken ? "Ukryj" : "Pokaz"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            >
              {showToken ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="inline-flex h-10 w-full items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/15 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20"
        >
          Dalej
        </button>
      </form>
    </>
  );
}
