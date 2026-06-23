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
        <div className="dashboard-auth-message dashboard-auth-message--error" role="alert">
          Nieprawidłowy identyfikator lub token.
        </div>
      ) : null}
      {loggedOut ? (
        <output className="dashboard-auth-message">
          Sesja została zakończona.
        </output>
      ) : null}

      <form action="/auth/login" method="post" className="dashboard-auth-form">
        <label>
          <span>Identyfikator</span>
          <input
            type="text"
            name="i"
            required
            autoComplete="off"
            spellCheck={false}
            aria-label="Identyfikator administratora"
            placeholder="np. admin@example.com"
          />
        </label>

        <label>
          <span>Token</span>
          <div className="dashboard-auth-token-row">
            <input
              type={showToken ? "text" : "password"}
              name="k"
              required
              autoComplete="off"
              aria-label="Token administratora"
              placeholder="Wklej token"
            />
            <button
              type="button"
              onClick={() => setShowToken((prev) => !prev)}
              aria-label={showToken ? "Ukryj token" : "Pokaż token"}
              title={showToken ? "Ukryj token" : "Pokaż token"}
              className="dashboard-auth-token-toggle"
            >
              {showToken ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="dashboard-auth-submit"
        >
          Zaloguj się
        </button>
      </form>
    </>
  );
}
