/**
 * Async-delta pending filter — vitest harness.
 *
 * All DB-backed store modules are mocked in-memory so this test never
 * touches a real database or SFTP connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  recordAsyncDelivery: vi.fn(async (packageId: string, deviceId: string) => {
    const alreadyPresent = state.deliveries.some(
      (d) => d.packageId === packageId && d.deviceId === deviceId,
    );
    if (!alreadyPresent) {
      state.deliveries.push({ packageId, deviceId });
    }
  }),
  getAckedDeviceIds: vi.fn(async (packageId: string) =>
    state.deliveries.filter((d) => d.packageId === packageId).map((d) => d.deviceId),
  ),
  getActiveDeviceIdsForGroup: vi.fn(async () => state.activeDevices),
  updateAsyncPackageStatus: vi.fn(async (id: string, status: string) => {
    const p = state.packages.find((x) => x.id === id);
    if (p) p.status = status;
    return p ?? null;
  }),
  getSenderCleanablePackages: vi.fn(async (groupId: string, deviceId: string) =>
    state.packages
      .filter((p) => p.groupId === groupId && p.fromDeviceId === deviceId &&
        (p.status === "delivered" || p.status === "expired" || p.status === "superseded"))
      .map((p) => ({ packageId: p.id, storagePath: p.storagePath }))),
  supersedeOwnPendingPackages: vi.fn(async (groupId: string, deviceId: string) => {
    let count = 0;
    for (const p of state.packages) {
      if (p.groupId === groupId && p.fromDeviceId === deviceId && p.status === "pending") {
        p.status = "superseded";
        count++;
      }
    }
    return count;
  }),
}));

import { handleAsyncPending, handleAsyncAck, handleAsyncSentCleanup, handleAsyncPush } from "../async-delta";
import { resetEnvForTests } from "@/lib/config/env";

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

  it("excludes packages already delivered to THIS device", async () => {
    state.packages.push(pkg("p1", "devA"));
    state.deliveries.push({ packageId: "p1", deviceId: "devB" });
    const res = await handleAsyncPending("owner1", "devB", "G1");
    expect(res.packages.map((p: any) => p.id)).toEqual([]);
  });
});

describe("async-delta ack (multi-receiver)", () => {
  it("keeps package pending until all active recipients (except sender) ack", async () => {
    state.activeDevices = ["devA", "devB", "devC"]; // sender devA, recipients B,C
    state.packages.push(pkg("p1", "devA"));

    let r = await handleAsyncAck("owner1", { deviceId: "devB", packageId: "p1" } as any);
    expect(r.acknowledged).toBe(true);
    expect(state.packages[0].status).toBe("pending"); // C not yet acked

    r = await handleAsyncAck("owner1", { deviceId: "devC", packageId: "p1" } as any);
    expect(state.packages[0].status).toBe("delivered"); // all acked
  });

  it("ack is idempotent for the same device", async () => {
    state.activeDevices = ["devA", "devB"];
    state.packages.push(pkg("p1", "devA"));
    await handleAsyncAck("owner1", { deviceId: "devB", packageId: "p1" } as any);
    await handleAsyncAck("owner1", { deviceId: "devB", packageId: "p1" } as any);
    expect(state.packages[0].status).toBe("delivered");
  });
});

describe("async-delta v2 gate (SYNC_ALLOW_E2E_V2)", () => {
  const v2Body = {
    deviceId: "devA",
    groupId: "G1",
    baseMarkerHash: null,
    newMarkerHash: "m1",
    fileSizeBytes: 10,
    keyScheme: "v2-passphrase" as const,
    keySalt: "timeflow-online-sync-e2e-v2|G1",
  };

  beforeEach(() => resetEnvForTests());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("rejects v2 push when SYNC_ALLOW_E2E_V2 is off (default)", async () => {
    vi.stubEnv("SYNC_ALLOW_E2E_V2", "false");
    await expect(handleAsyncPush("owner1", v2Body)).rejects.toMatchObject({
      code: "key_scheme_not_supported_yet",
    });
  });

  it("rejects v2 push without keySalt even when enabled", async () => {
    vi.stubEnv("SYNC_ALLOW_E2E_V2", "true");
    await expect(
      handleAsyncPush("owner1", { ...v2Body, keySalt: "" }),
    ).rejects.toMatchObject({ code: "key_salt_required" });
  });

  it("rejects an unknown keyScheme", async () => {
    await expect(
      handleAsyncPush("owner1", { ...v2Body, keyScheme: "v9-bogus" as never }),
    ).rejects.toMatchObject({ code: "unsupported_key_scheme" });
  });
});

describe("async-delta sent-cleanup", () => {
  it("lists sender's own delivered/expired/superseded packages only", async () => {
    state.packages.push({ ...pkg("p1", "devA"), status: "delivered", storagePath: "/async/p1" });
    state.packages.push({ ...pkg("p2", "devA"), status: "pending", storagePath: "/async/p2" });
    state.packages.push({ ...pkg("p3", "devB"), status: "expired", storagePath: "/async/p3" });
    state.packages.push({ ...pkg("p4", "devA"), status: "superseded", storagePath: "/async/p4" });
    const res = await handleAsyncSentCleanup("owner1", "devA", "G1");
    // p1 (delivered) + p4 (superseded) — własne; p2 wciąż pending, p3 cudze.
    expect(res.packages.map((p) => p.packageId).sort()).toEqual(["p1", "p4"]);
  });

  it("superseded own pending packages become cleanable (no FTP spam without a 2nd device)", async () => {
    const { supersedeOwnPendingPackages } = await import("../session-store");
    // Dwie własne paczki pending — jak po dwóch pushach bez odbiorcy.
    state.packages.push({ ...pkg("p1", "devA"), status: "pending", storagePath: "/async/p1" });
    state.packages.push({ ...pkg("p2", "devA"), status: "pending", storagePath: "/async/p2" });
    // Nowy push unieważnia poprzednie własne pending.
    const count = await supersedeOwnPendingPackages("G1", "devA");
    expect(count).toBe(2);
    // Teraz obie są sender-cleanable → klient skasuje je z FTP od razu.
    const res = await handleAsyncSentCleanup("owner1", "devA", "G1");
    expect(res.packages.map((p) => p.packageId).sort()).toEqual(["p1", "p2"]);
  });
});
