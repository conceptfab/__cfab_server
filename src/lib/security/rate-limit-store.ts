import { getEnv } from "@/lib/config/env";

export interface RateLimitCounter {
  count: number;
  resetAt: number;
}

/** Backend for rate-limit counters. Abstracts in-memory vs shared (KV/Redis). */
export interface RateLimitStore {
  /** Atomically increment the window counter and return the current state. */
  incr(key: string, windowMs: number): Promise<RateLimitCounter>;
}

// ---------------------------------------------------------------------------
// In-memory store (per-instance). Correct only on a single instance — used for
// local dev / tests and as fallback when no shared store is configured.
// ---------------------------------------------------------------------------

interface Entry {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, Entry>();

  private maybePrune(now: number): void {
    if (this.store.size < 5000) return;
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) this.store.delete(key);
    }
  }

  async incr(key: string, windowMs: number): Promise<RateLimitCounter> {
    const now = Date.now();
    this.maybePrune(now);
    const existing = this.store.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.resetAt };
  }
}

// ---------------------------------------------------------------------------
// Shared store over Upstash/Vercel KV REST (Upstash-compatible). Uses a pipeline
// of INCR + PEXPIRE key windowMs NX + PTTL so the first request of a window sets
// the TTL and subsequent ones only increment. Works across serverless instances.
// ---------------------------------------------------------------------------

interface UpstashPipelineItem {
  result?: number | string | null;
  error?: string;
}

export class UpstashRestRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async incr(key: string, windowMs: number): Promise<RateLimitCounter> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`rate-limit store HTTP ${res.status}`);
    }

    const data = (await res.json()) as UpstashPipelineItem[];
    const count = Number(data[0]?.result ?? 0);
    const pttl = Number(data[2]?.result ?? -1);
    const resetAt = pttl > 0 ? Date.now() + pttl : Date.now() + windowMs;
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error("rate-limit store returned invalid count");
    }
    return { count, resetAt };
  }
}

// ---------------------------------------------------------------------------
// Store selection (cached per process).
// ---------------------------------------------------------------------------

let cachedStore: RateLimitStore | null = null;
let cachedIsShared = false;

function buildStore(): { store: RateLimitStore; shared: boolean } {
  const env = getEnv();
  if (env.kvRestApiUrl && env.kvRestApiToken) {
    return {
      store: new UpstashRestRateLimitStore(env.kvRestApiUrl, env.kvRestApiToken),
      shared: true,
    };
  }
  return { store: new InMemoryRateLimitStore(), shared: false };
}

export function getRateLimitStore(): { store: RateLimitStore; shared: boolean } {
  if (cachedStore) return { store: cachedStore, shared: cachedIsShared };
  const built = buildStore();
  cachedStore = built.store;
  cachedIsShared = built.shared;
  return built;
}

/** Test-only: reset the cached store selection. */
export function resetRateLimitStoreForTests(): void {
  cachedStore = null;
  cachedIsShared = false;
}
