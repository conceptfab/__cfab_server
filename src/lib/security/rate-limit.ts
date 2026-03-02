export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function nowMs(): number {
  return Date.now();
}

function maybePrune(): void {
  if (store.size < 5000) {
    return;
  }

  const now = nowMs();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  maybePrune();

  const now = nowMs();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfterMs: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, existing.resetAt - now);
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterMs,
  };
}

