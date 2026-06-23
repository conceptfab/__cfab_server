"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const COMMANDS = [
  { label: "Przegląd", href: "/?view=overview", hint: "Stan systemu" },
  { label: "Aktywność", href: "/?view=activity", hint: "Historia synchronizacji" },
  { label: "Urządzenia", href: "/?view=devices", hint: "Połączone klienty" },
  { label: "Licencje", href: "/?view=licenses", hint: "Klucze i limity" },
  { label: "Grupy", href: "/?view=groups", hint: "Przypisania klientów" },
  { label: "Storage", href: "/?view=storage", hint: "Backendy plików" },
] as const;

export function DashboardCommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl-PL");
    if (!normalized) return COMMANDS;
    return COMMANDS.filter(({ label, hint }) =>
      `${label} ${hint}`.toLocaleLowerCase("pl-PL").includes(normalized),
    );
  }, [query]);

  function openMenu() {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openMenu();
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) =>
          filteredCommands.length === 0 ? 0 : (index + 1) % filteredCommands.length,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) =>
          filteredCommands.length === 0
            ? 0
            : (index - 1 + filteredCommands.length) % filteredCommands.length,
        );
      } else if (event.key === "Enter" && filteredCommands[activeIndex]) {
        event.preventDefault();
        window.location.href = filteredCommands[activeIndex].href;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredCommands, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        className="dashboard-command-trigger"
        onClick={openMenu}
        ref={triggerRef}
        type="button"
      >
        <span>Szukaj zasobów…</span>
        <kbd>⌘ K</kbd>
      </button>

      {open && (
        <div
          className="dashboard-command-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <section
            aria-label="Przejdź do widoku"
            aria-modal="true"
            className="dashboard-command-dialog"
            role="dialog"
          >
            <label>
              <span className="sr-only">Szukaj widoku</span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Przejdź do widoku…"
                ref={inputRef}
                role="searchbox"
                value={query}
              />
              <kbd>ESC</kbd>
            </label>
            <div className="dashboard-command-results">
              {filteredCommands.length === 0 ? (
                <p>Brak pasujących widoków.</p>
              ) : (
                filteredCommands.map((command, index) => (
                  <Link
                    aria-label={command.label}
                    className={index === activeIndex ? "is-active" : undefined}
                    href={command.href}
                    key={command.href}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span><strong>{command.label}</strong><small>{command.hint}</small></span>
                    <span aria-hidden="true">→</span>
                  </Link>
                ))
              )}
            </div>
            <footer><span>↑↓ wybierz</span><span>↵ otwórz</span><span>esc zamknij</span></footer>
          </section>
        </div>
      )}
    </>
  );
}
