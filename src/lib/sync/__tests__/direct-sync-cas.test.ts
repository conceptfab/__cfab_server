/**
 * CAS (compare-and-swap) on /sync/push.
 *
 * Verifies that handlePush rejects a push built on a stale knownServerRevision,
 * so two concurrent pushes from the same base cannot overwrite each other.
 *
 * Storage is now Postgres. We mock `@/lib/db` with an in-memory Prisma double
 * that enforces the `@@unique([userId, revision])` constraint (the CAS guard),
 * so the control flow can be exercised without a live database.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// --- In-memory Prisma double backing direct-sync's storage ------------------
vi.mock("@/lib/db", async () => {
  const { Prisma } = await import("@prisma/client");

  type Head = {
    userId: string;
    latestRevision: number;
    latestSnapshotId: string | null;
    latestPayloadSha256: string | null;
    latestDeviceId: string | null;
    latestTableHashesJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  };

  const heads = new Map<string, Head>();
  const snapshots: Array<{ id: string; userId: string; revision: number; archiveJson: unknown }> = [];
  const users = new Set<string>();
  const history: unknown[] = [];
  let snapSeq = 0;

  function uniqueViolation() {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
  }

  const db = {
    user: {
      upsert: async ({ where }: { where: { id: string } }) => {
        users.add(where.id);
        return { id: where.id };
      },
    },
    syncSnapshot: {
      create: async ({ data }: { data: { userId: string; revision: number; archiveJson: unknown } }) => {
        if (snapshots.some((s) => s.userId === data.userId && s.revision === data.revision)) {
          throw uniqueViolation();
        }
        const row = { id: `snap-${++snapSeq}`, userId: data.userId, revision: data.revision, archiveJson: data.archiveJson };
        snapshots.push(row);
        return row;
      },
    },
    syncHead: {
      findUnique: async ({ where, include }: { where: { userId: string }; include?: { latestSnapshot?: unknown } }) => {
        const head = heads.get(where.userId);
        if (!head) return null;
        if (include?.latestSnapshot) {
          const snap = snapshots.find((s) => s.id === head.latestSnapshotId) ?? null;
          return { ...head, latestSnapshot: snap ? { archiveJson: snap.archiveJson } : null };
        }
        return head;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Partial<Head>;
        update: Partial<Head>;
      }) => {
        const existing = heads.get(where.userId);
        const next = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : ({ createdAt: new Date(), updatedAt: new Date(), ...create } as Head);
        heads.set(where.userId, next as Head);
        return next;
      },
      updateMany: async ({ where, data }: { where: { userId: string }; data: Partial<Head> }) => {
        const head = heads.get(where.userId);
        if (head) Object.assign(head, data);
        return { count: head ? 1 : 0 };
      },
    },
    directSyncHistory: {
      create: async ({ data }: { data: unknown }) => {
        history.unshift(data);
        return data;
      },
      findMany: async ({ skip = 0, take }: { skip?: number; take?: number } = {}) =>
        history.slice(skip, take != null ? skip + take : undefined),
      deleteMany: async () => {
        const count = history.length;
        history.length = 0;
        return { count };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    $queryRaw: async () => [{ ok: 1 }],

    // --- test-only helpers ---
    __seedHead: (userId: string, revision: number) => {
      const now = new Date();
      heads.set(userId, {
        userId,
        latestRevision: revision,
        latestSnapshotId: null,
        latestPayloadSha256: `seeded-hash-r${revision}`,
        latestDeviceId: "seed-device",
        latestTableHashesJson: null,
        createdAt: now,
        updatedAt: now,
      });
    },
    __reset: () => {
      heads.clear();
      snapshots.length = 0;
      users.clear();
      history.length = 0;
      snapSeq = 0;
    },
  };

  return { prisma: db };
});

// Isolate direct-sync from the DB-backed license store (heartbeats are no-ops).
vi.mock("../license-store", () => ({
  touchDeviceLastSeen: async () => {},
  updateDeviceLastSync: async () => {},
  getDevice: async () => null,
  getDevicesForLicense: async () => [],
  getDevicesForUser: async () => [],
}));

import { prisma } from "@/lib/db";
import * as directSync from "../direct-sync";

const seed = (userId: string, revision: number) =>
  (prisma as unknown as { __seedHead: (u: string, r: number) => void }).__seedHead(userId, revision);

const USER_ID = "cas-test-user";

beforeEach(() => {
  (prisma as unknown as { __reset: () => void }).__reset();
});

describe("handlePush CAS (compare-and-swap)", () => {
  it("rejects a push whose knownServerRevision is behind the server", async () => {
    seed(USER_ID, 5);

    const res = await directSync.handlePush(USER_ID, {
      userId: USER_ID,
      deviceId: "device-A",
      knownServerRevision: 3, // client thinks server is at r3, but it's r5
      archive: { version: "1", data: { projects: [{ id: "p-stale" }] } },
    });

    expect(res.accepted).toBe(false);
    expect(res.reason).toBe("stale_revision");
    expect(res.revision).toBe(5); // tells client the real current revision
  });

  it("accepts a push whose knownServerRevision matches the server and bumps the revision", async () => {
    seed(USER_ID, 5);

    const res = await directSync.handlePush(USER_ID, {
      userId: USER_ID,
      deviceId: "device-B",
      knownServerRevision: 5, // up to date with server
      archive: { version: "1", data: { projects: [{ id: "p-fresh" }] } },
    });

    expect(res.accepted).toBe(true);
    expect(res.revision).toBe(6);
  });

  it("accepts an initial push (knownServerRevision null, no head yet)", async () => {
    const bootstrapUser = "cas-bootstrap-user";

    const res = await directSync.handlePush(bootstrapUser, {
      userId: bootstrapUser,
      deviceId: "device-C",
      knownServerRevision: null,
      archive: { version: "1", data: { projects: [{ id: "p-initial" }] } },
    });

    expect(res.accepted).toBe(true);
    expect(res.revision).toBe(1);
  });
});
