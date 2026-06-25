import { describe, it, expect, afterEach, vi } from "vitest";

import { getEnv, resetEnvForTests } from "../env";

// Regression: env.ts must NOT depend on the structured logger.
//
// The logger's log() calls getEnv() → buildEnv(); emitting a log from inside
// buildEnv() (before cachedEnv is assigned) caused infinite mutual recursion
// (RangeError: Maximum call stack size exceeded) on EVERY request in
// production whenever SYNC_ALLOWED_ORIGINS="*". The A4 unit test mocked the
// logger, so it never surfaced — this test deliberately does NOT mock it.
describe("env: no recursion on wildcard CORS in production (regression)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("getEnv() does not stack-overflow when prod + SYNC_ALLOWED_ORIGINS=*", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SYNC_ALLOWED_ORIGINS", "*");
    resetEnvForTests();

    // A normal config error (e.g. missing SYNC_API_TOKENS) is acceptable here;
    // the regression we guard against is the stack-overflow RangeError.
    try {
      const env = getEnv();
      expect(env.syncAllowedOrigins).toEqual(["*"]);
    } catch (e) {
      expect(e).not.toBeInstanceOf(RangeError);
      expect((e as Error).message).not.toMatch(/call stack/i);
    }
  });
});
