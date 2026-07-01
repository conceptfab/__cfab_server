import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";
import { getRateLimitStore } from "@/lib/security/rate-limit-store";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

export interface RateLimitOptions {
  /** Behavior when the shared store is unreachable. Defaults to env RATE_LIMIT_FAILURE_MODE. */
  failureMode?: "fail-open" | "fail-closed";
}

/**
 * Increment and evaluate a rate-limit window against the configured store
 * (shared KV/Redis when provisioned, else per-instance in-memory).
 *
 * On serverless the in-memory fallback is per-instance and therefore only
 * approximate — provision KV (KV_REST_API_URL/KV_REST_API_TOKEN) for effective
 * global limits.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  const { store } = getRateLimitStore();

  try {
    const { count, resetAt } = await store.incr(key, windowMs);
    const allowed = count <= limit;
    const now = Date.now();
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, resetAt - now),
    };
  } catch (error) {
    const env = getEnv();
    const failureMode = options?.failureMode ?? env.rateLimitFailureMode;
    log("warn", "rate-limit.store-unavailable", {
      failureMode,
      message: error instanceof Error ? error.message : String(error),
    });

    const now = Date.now();
    if (failureMode === "fail-closed") {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: now + windowMs,
        retryAfterMs: windowMs,
      };
    }
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt: now + windowMs,
      retryAfterMs: 0,
    };
  }
}
