"use client";

import type { ReactNode } from "react";
import { useId, useRef } from "react";

export function DashboardDrawer({
  title,
  triggerLabel,
  children,
  tone = "primary",
}: {
  title: string;
  triggerLabel: string;
  children: ReactNode;
  tone?: "primary" | "secondary";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  function openDrawer() {
    dialogRef.current?.showModal();
  }

  function closeDrawer() {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        className={`dashboard-button dashboard-button--${tone}`}
        onClick={openDrawer}
        ref={triggerRef}
        type="button"
      >
        {triggerLabel}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="dashboard-drawer"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        ref={dialogRef}
      >
        <div className="dashboard-drawer-panel">
          <header>
            <h2 id={titleId}>{title}</h2>
            <button
              aria-label="Zamknij"
              className="dashboard-icon-button"
              onClick={closeDrawer}
              type="button"
            >
              ×
            </button>
          </header>
          <div className="dashboard-drawer-content">{children}</div>
        </div>
      </dialog>
    </>
  );
}
