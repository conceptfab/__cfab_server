import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  buildDashboardSessionCookieValue,
  getDashboardUserIdFromCookie,
} from "../dashboard-page-auth";
import { resetEnvForTests } from "@/lib/config/env";

describe("dashboard signed session (#7)", () => {
  beforeEach(() => {
    resetEnvForTests();
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-secret-key-at-least-16-chars");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("round-trips a valid signed session", () => {
    const cookie = buildDashboardSessionCookieValue("user-1");
    expect(cookie).toContain("."); // payload.signature
    expect(getDashboardUserIdFromCookie(cookie)).toBe("user-1");
  });

  it("does not embed the raw API token", () => {
    const cookie = buildDashboardSessionCookieValue("user-1");
    const [payloadB64] = cookie.split(".");
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    expect(payload).not.toMatch(/token/i);
    expect(JSON.parse(payload)).toMatchObject({ userId: "user-1" });
  });

  it("rejects a tampered payload", () => {
    const cookie = buildDashboardSessionCookieValue("user-1");
    const [, sig] = cookie.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: "attacker", exp: Date.now() + 100000 }),
      "utf8",
    ).toString("base64url");
    expect(getDashboardUserIdFromCookie(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects an expired session", () => {
    vi.useFakeTimers();
    try {
      const cookie = buildDashboardSessionCookieValue("user-1");
      vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000); // +9h > 8h TTL
      expect(getDashboardUserIdFromCookie(cookie)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null for garbage input", () => {
    expect(getDashboardUserIdFromCookie("not-a-cookie")).toBeNull();
    expect(getDashboardUserIdFromCookie(undefined)).toBeNull();
  });
});
