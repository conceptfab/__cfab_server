export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAsyncPush } from "@/lib/sync/async-delta";
import type { AsyncPushBody, AsyncPushResponse } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";
import { ensureCleanupRunning } from "@/lib/sync/session-cleanup";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  ensureCleanupRunning();
  return handleSyncPost<AsyncPushBody, AsyncPushResponse>(request, {
    route: "async-push",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.groupId !== "string" || !body.groupId.trim()) {
        throw badRequest("groupId is required");
      }
      if (typeof body.newMarkerHash !== "string" || !body.newMarkerHash.trim()) {
        throw badRequest("newMarkerHash is required");
      }
      if (typeof body.fileSizeBytes !== "number" || body.fileSizeBytes <= 0) {
        throw badRequest("fileSizeBytes must be a positive number");
      }
      return {
        deviceId: body.deviceId,
        groupId: body.groupId,
        baseMarkerHash: typeof body.baseMarkerHash === "string" ? body.baseMarkerHash : null,
        newMarkerHash: body.newMarkerHash,
        fileSizeBytes: body.fileSizeBytes,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleAsyncPush(userId, body),
    summarizeResult: (result) => ({
      packageId: result.packageId,
      expiresAt: result.expiresAt,
    }),
  });
}
