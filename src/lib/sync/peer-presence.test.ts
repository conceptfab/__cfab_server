import { describe, it, expect } from "vitest";
import { isPeerPresent, PEER_PRESENCE_WINDOW_MS } from "./peer-presence";

const NOW = 1_700_000_000_000; // fixed epoch ms — no Date.now() in tests
const W = PEER_PRESENCE_WINDOW_MS;

describe("isPeerPresent", () => {
  it("false when only the requesting device exists", () => {
    const devices = [{ deviceId: "A", lastSeenAt: new Date(NOW).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("ignores the requesting device's own freshness", () => {
    const devices = [{ deviceId: "A", lastSeenAt: new Date(NOW).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("false when the other device is stale", () => {
    const devices = [
      { deviceId: "A", lastSeenAt: new Date(NOW).toISOString() },
      { deviceId: "B", lastSeenAt: new Date(NOW - W - 1).toISOString() },
    ];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("true when another device is fresh", () => {
    const devices = [{ deviceId: "B", lastSeenAt: new Date(NOW - 1000).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(true);
  });

  it("false when the other device has null lastSeenAt", () => {
    const devices = [{ deviceId: "B", lastSeenAt: null }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("exactly at the window boundary counts as stale", () => {
    const devices = [{ deviceId: "B", lastSeenAt: new Date(NOW - W).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });
});
