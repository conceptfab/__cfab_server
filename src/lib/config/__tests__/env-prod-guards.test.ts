import { describe, it, expect, afterEach, vi } from "vitest";
import { getEnv, resetEnvForTests } from "../env";

// env.ts uses a module-level memoised cache (cachedEnv). We reset it before
// each case so buildEnv() re-runs with the freshly-stubbed process.env.

describe("env prod guards", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("dev-userid fallback is FORCED OFF in production regardless of flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SYNC_ALLOW_INSECURE_DEV_USERID_FALLBACK", "true");
    // production also requires SYNC_API_TOKENS when auth mode = token (default)
    vi.stubEnv("SYNC_API_TOKENS", "u1=tok1");
    resetEnvForTests();
    expect(getEnv().syncAllowInsecureDevUserIdFallback).toBe(false);
  });

  it("dev-userid fallback still available outside production when flag on", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SYNC_ALLOW_INSECURE_DEV_USERID_FALLBACK", "true");
    resetEnvForTests();
    expect(getEnv().syncAllowInsecureDevUserIdFallback).toBe(true);
  });
});
