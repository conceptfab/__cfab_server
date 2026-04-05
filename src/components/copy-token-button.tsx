"use client";

export function CopyTokenButton({ token }: { token: string }) {
  return (
    <button
      type="button"
      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
      title="Kliknij aby skopiowac token"
      onClick={() => { navigator.clipboard.writeText(token); }}
    >
      {token.slice(0, 8)}&hellip;
    </button>
  );
}
