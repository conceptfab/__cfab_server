import { describe, expect, it } from "vitest";

import { buildDashboardOverview } from "./overview";

const emptyData = {
  licenses: [],
  groups: [],
  devices: [],
  storageBackends: [],
  directSyncHistory: [],
};

describe("buildDashboardOverview", () => {
  it("marks the system degraded when storage is offline", () => {
    const result = buildDashboardOverview(
      emptyData,
      {
        available: false,
        lastCheckAt: "2026-06-23T12:00:00.000Z",
        error: "ECONNREFUSED",
      },
      192,
    );

    expect(result.systemStatus).toBe("degraded");
    expect(result.alert?.targetView).toBe("storage");
    expect(result.setup.completed).toBe(1);
    expect(result.counts).toEqual({
      devices: 0,
      licenses: 0,
      groups: 0,
      storageBackends: 0,
    });
  });

  it("marks setup complete when storage, a license and a device exist", () => {
    const result = buildDashboardOverview(
      {
        ...emptyData,
        licenses: [{}],
        groups: [{}],
        devices: [{}],
        storageBackends: [{}],
      },
      {
        available: true,
        lastCheckAt: "2026-06-23T12:00:00.000Z",
        error: null,
      },
      3600,
    );

    expect(result.systemStatus).toBe("operational");
    expect(result.setup.completed).toBe(4);
    expect(result.alert).toBeNull();
  });
});
