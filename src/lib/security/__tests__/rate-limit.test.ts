import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { checkRateLimit } from "../rate-limit";
import { resetRateLimitStoreForTests } from "../rate-limit-store";
import { resetEnvForTests } from "@/lib/config/env";

describe("checkRateLimit (in-memory fallback)", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitStoreForTests();
    // Ensure no shared store configured → in-memory path.
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetEnvForTests();
    resetRateLimitStoreForTests();
  });

  it("allows up to `limit` requests then blocks", async () => {
    const key = `test:${Math.random()}`;
    const r1 = await checkRateLimit(key, 2, 60_000);
    const r2 = await checkRateLimit(key, 2, 60_000);
    const r3 = await checkRateLimit(key, 2, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    vi.useFakeTimers();
    const key = `test:${Math.random()}`;
    await checkRateLimit(key, 1, 1_000);
    const blocked = await checkRateLimit(key, 1, 1_000);
    expect(blocked.allowed).toBe(false);

    vi.setSystemTime(Date.now() + 1_500);
    const afterReset = await checkRateLimit(key, 1, 1_000);
    expect(afterReset.allowed).toBe(true);
  });
});

describe("checkRateLimit failure modes (shared store unreachable)", () => {
  beforeEach(() => {
    resetEnvForTests();
    resetRateLimitStoreForTests();
    vi.stubEnv("KV_REST_API_URL", "https://example.invalid");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    // Make the store call fail.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvForTests();
    resetRateLimitStoreForTests();
  });

  it("fail-open allows the request when store is down", async () => {
    const r = await checkRateLimit("k", 5, 60_000, { failureMode: "fail-open" });
    expect(r.allowed).toBe(true);
  });

  it("fail-closed blocks the request when store is down", async () => {
    const r = await checkRateLimit("k", 5, 60_000, { failureMode: "fail-closed" });
    expect(r.allowed).toBe(false);
  });
});
