import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/sync/session-cleanup", () => ({
  runSessionCleanup: vi.fn(async () => ({ sessions: 0, asyncPackages: 0 })),
}));

vi.mock("@/lib/observability/logger", () => ({
  log: vi.fn(),
}));

import { GET } from "../../cron/session-cleanup/route";

describe("cron/session-cleanup auth", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects with 503 in production when CRON_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(new Request("https://x/api/cron/session-cleanup"));
    expect(res.status).toBe(503);
  });

  it("rejects with 401 when secret set but header wrong", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    const res = await GET(new Request("https://x/api/cron/session-cleanup", {
      headers: { authorization: "Bearer wrong" },
    }));
    expect(res.status).toBe(401);
  });

  it("allows with correct secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    const res = await GET(new Request("https://x/api/cron/session-cleanup", {
      headers: { authorization: "Bearer s3cr3t" },
    }));
    expect(res.status).toBe(200);
  });

  it("allows in non-production when CRON_SECRET is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(new Request("https://x/api/cron/session-cleanup"));
    expect(res.status).toBe(200);
  });
});
