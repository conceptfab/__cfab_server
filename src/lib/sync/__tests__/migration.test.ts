import { describe, it, expect } from "vitest";

import { computeGroupV2Readiness } from "../migration";

const NOW = 1_000_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

describe("computeGroupV2Readiness", () => {
  it("allV2 is false when the group has no active devices", () => {
    const r = computeGroupV2Readiness([], NOW);
    expect(r).toEqual({ activeDevices: 0, v2Capable: 0, allV2: false });
  });

  it("allV2 is true only when every active device is v2-capable", () => {
    const r = computeGroupV2Readiness(
      [
        { lastSeenAt: iso(1 * DAY), supportsV2: true },
        { lastSeenAt: iso(2 * DAY), supportsV2: true },
      ],
      NOW,
    );
    expect(r).toEqual({ activeDevices: 2, v2Capable: 2, allV2: true });
  });

  it("allV2 is false when any active device is v1-only", () => {
    const r = computeGroupV2Readiness(
      [
        { lastSeenAt: iso(1 * DAY), supportsV2: true },
        { lastSeenAt: iso(1 * DAY), supportsV2: false },
      ],
      NOW,
    );
    expect(r.allV2).toBe(false);
    expect(r).toMatchObject({ activeDevices: 2, v2Capable: 1 });
  });

  it("ignores devices outside the active window", () => {
    const r = computeGroupV2Readiness(
      [
        { lastSeenAt: iso(1 * DAY), supportsV2: true }, // active, v2
        { lastSeenAt: iso(40 * DAY), supportsV2: false }, // stale v1 — ignored
      ],
      NOW,
    );
    expect(r).toEqual({ activeDevices: 1, v2Capable: 1, allV2: true });
  });

  it("treats an unparseable timestamp as inactive", () => {
    const r = computeGroupV2Readiness(
      [{ lastSeenAt: "not-a-date", supportsV2: true }],
      NOW,
    );
    expect(r.activeDevices).toBe(0);
    expect(r.allV2).toBe(false);
  });
});
