/**
 * CAS (compare-and-swap) on /sync/push.
 *
 * Verifies that handlePush rejects a push built on a stale knownServerRevision,
 * so two concurrent pushes from the same base cannot overwrite each other.
 *
 * Data isolation: SYNC_DATA_DIR is set to a per-run tmp dir BEFORE the module
 * under test is imported (its DATA_DIR const is resolved at import time).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// --- Resolve an isolated data dir and wire it up before importing the module ---
let dataDir: string;
let directSync: typeof import("../direct-sync");

const USER_ID = "cas-test-user";

/** Mirror of direct-sync's userDir() sanitization so we can seed meta.json. */
function userMetaPath(root: string, userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(root, "online-sync", safe, "meta.json");
}

/** Seed a meta.json for the user at a given revision (simulates prior server state). */
async function seedMeta(revision: number): Promise<void> {
  const metaPath = userMetaPath(dataDir, USER_ID);
  await mkdir(path.dirname(metaPath), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    metaPath,
    JSON.stringify({
      revision,
      payloadSha256: `seeded-hash-r${revision}`,
      tableHashes: null,
      updatedAt: now,
      createdAt: now,
      deviceId: "seed-device",
    }),
    "utf8",
  );
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cfab-cas-"));
  process.env.SYNC_DATA_DIR = dataDir;
  // Import AFTER env is set so DATA_DIR/REPO_DIR consts resolve to the tmp dir.
  directSync = await import("../direct-sync");
});

afterAll(async () => {
  if (!dataDir) return;
  // Fire-and-forget history/device writes inside handlePush may still be
  // settling; retry the cleanup so a transient ENOTEMPTY doesn't fail the run.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});

describe("handlePush CAS (compare-and-swap)", () => {
  it("rejects a push whose knownServerRevision is behind the server", async () => {
    await seedMeta(5);

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
    await seedMeta(5);

    const res = await directSync.handlePush(USER_ID, {
      userId: USER_ID,
      deviceId: "device-B",
      knownServerRevision: 5, // up to date with server
      archive: { version: "1", data: { projects: [{ id: "p-fresh" }] } },
    });

    expect(res.accepted).toBe(true);
    expect(res.revision).toBe(6);
  });

  it("accepts an initial push (knownServerRevision null, no meta.json yet)", async () => {
    // Distinct user with no prior server state — bootstrap path.
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
