/**
 * getGroupForLicense 1:1 guard — vitest harness.
 *
 * Verifies that when a licenseId maps to >1 group (data anomaly), the function
 * always returns the group with the lexicographically lowest id (deterministic),
 * does not throw, and emits a warning log.
 *
 * Real ordering is enforced by the DB `orderBy: { id: "asc" }` clause.
 * The mock returns rows already sorted ascending so the "pick first" assertion
 * holds without relying on DB behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these variables are available at mock-factory time
// (vi.mock calls are hoisted to the top of the file by vitest).
const { mockFindMany, mockLog } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockLog: vi.fn(),
}));

// Mock the logger before importing the module under test.
vi.mock("@/lib/observability/logger", () => ({ log: mockLog }));

// Mock the prisma client used by license-store.ts.
// The real accessor is prisma.group (Prisma model `Group`, table `client_groups`).
vi.mock("@/lib/db", () => ({
  prisma: {
    group: { findMany: mockFindMany },
  },
}));

import { getGroupForLicense } from "../license-store";

// Minimal PrismaGroup rows — includes every field that mapGroup reads.
const rowG1 = {
  id: "G1",
  name: "Group One",
  ownerId: "owner1",
  licenseId: "L1",
  storageBackendId: "default",
  fixedMasterDeviceId: null,
  syncPriority: {},
  maxSyncFrequencyHours: null,
  maxDatabaseSizeMb: null,
};

const rowG2 = {
  id: "G2",
  name: "Group Two",
  ownerId: "owner1",
  licenseId: "L1",
  storageBackendId: "default",
  fixedMasterDeviceId: null,
  syncPriority: {},
  maxSyncFrequencyHours: null,
  maxDatabaseSizeMb: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGroupForLicense 1:1 guard", () => {
  it("returns null when no group exists for the license", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const result = await getGroupForLicense("L_NONE");
    expect(result).toBeNull();
  });

  it("returns the single group for the normal 1-group case", async () => {
    mockFindMany.mockResolvedValueOnce([rowG1]);
    const result = await getGroupForLicense("L1");
    expect(result?.id).toBe("G1");
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("returns the lowest-id group deterministically when a license maps to >1 group", async () => {
    // Mock returns rows already sorted asc (as the real DB orderBy would do).
    mockFindMany.mockResolvedValueOnce([rowG1, rowG2]);
    const result = await getGroupForLicense("L1");
    expect(result?.id).toBe("G1");
  });

  it("emits a warning log when >1 group is found", async () => {
    mockFindMany.mockResolvedValueOnce([rowG1, rowG2]);
    await getGroupForLicense("L1");
    expect(mockLog).toHaveBeenCalledWith(
      "error",
      "license.multiple_groups_for_license",
      expect.objectContaining({ licenseId: "L1", count: 2 }),
    );
  });

  it("does not throw when >1 group is found", async () => {
    mockFindMany.mockResolvedValueOnce([rowG1, rowG2]);
    await expect(getGroupForLicense("L1")).resolves.not.toThrow();
  });
});
