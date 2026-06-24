import { describe, it, expect, afterEach, vi } from "vitest";
import { isLegacyDirectSyncEnabled } from "../legacy-gate";

describe("legacy-gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("disabled by default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SYNC_ENABLE_LEGACY_DIRECT", "");
    expect(isLegacyDirectSyncEnabled()).toBe(false);
  });

  it("enabled in production only with explicit flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SYNC_ENABLE_LEGACY_DIRECT", "true");
    expect(isLegacyDirectSyncEnabled()).toBe(true);
  });

  it("enabled by default outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SYNC_ENABLE_LEGACY_DIRECT", "");
    expect(isLegacyDirectSyncEnabled()).toBe(true);
  });

  it("explicit false disables even outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SYNC_ENABLE_LEGACY_DIRECT", "false");
    expect(isLegacyDirectSyncEnabled()).toBe(false);
  });
});
