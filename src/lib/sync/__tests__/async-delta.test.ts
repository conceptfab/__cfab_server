/**
 * Async-delta pending filter — vitest harness.
 *
 * All DB-backed store modules are mocked in-memory so this test never
 * touches a real database or SFTP connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory store controlled by tests
const state = {
  packages: [] as any[],
  deliveries: [] as { packageId: string; deviceId: string }[],
  activeDevices: ["devA", "devB"] as string[],
  groups: [{ id: "G1", ownerId: "owner1" }] as any[],
};

vi.mock("../license-store", () => ({
  getAllGroups: vi.fn(async () => state.groups),
  getStorageBackend: vi.fn(async () => null),
}));

vi.mock("../session-store", () => ({
  createAsyncPackage: vi.fn(async (p: any) => state.packages.push(p)),
  getAsyncPackage: vi.fn(async (id: string) => state.packages.find((p) => p.id === id) ?? null),
  getPendingPackagesForGroup: vi.fn(async (groupId: string, deviceId: string) =>
    state.packages.filter(
      (p) =>
        p.groupId === groupId &&
        p.status === "pending" &&
        p.fromDeviceId !== deviceId &&
        !state.deliveries.some((d) => d.packageId === p.id && d.deviceId === deviceId),
    ),
  ),
  recordAsyncDelivery: vi.fn(async (packageId: string, deviceId: string) =>
    state.deliveries.push({ packageId, deviceId }),
  ),
  getAckedDeviceIds: vi.fn(async (packageId: string) =>
    state.deliveries.filter((d) => d.packageId === packageId).map((d) => d.deviceId),
  ),
  getActiveDeviceIdsForGroup: vi.fn(async () => state.activeDevices),
  updateAsyncPackageStatus: vi.fn(async (id: string, status: string) => {
    const p = state.packages.find((x) => x.id === id);
    if (p) p.status = status;
    return p ?? null;
  }),
}));

import { handleAsyncPending } from "../async-delta";

function pkg(id: string, from: string) {
  return {
    id,
    groupId: "G1",
    fromDeviceId: from,
    status: "pending",
    expiresAt: new Date(Date.now() + 1e6).toISOString(),
  };
}

beforeEach(() => {
  state.packages = [];
  state.deliveries = [];
  state.activeDevices = ["devA", "devB"];
});

describe("async-delta pending filter", () => {
  it("excludes sender's own packages", async () => {
    state.packages.push(pkg("p1", "devA"));
    const res = await handleAsyncPending("owner1", "devA", "G1");
    expect(res.packages.map((p: any) => p.id)).toEqual([]);
  });

  it("returns packages from other devices", async () => {
    state.packages.push(pkg("p1", "devA"));
    const res = await handleAsyncPending("owner1", "devB", "G1");
    expect(res.packages.map((p: any) => p.id)).toEqual(["p1"]);
  });
});
