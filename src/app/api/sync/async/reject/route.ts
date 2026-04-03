export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAsyncReject } from "@/lib/sync/async-delta";
import type { AsyncRejectBody, AsyncRejectResponse } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<AsyncRejectBody, AsyncRejectResponse>(request, {
    route: "async-reject",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.packageId !== "string" || !body.packageId.trim()) {
        throw badRequest("packageId is required");
      }
      return {
        deviceId: body.deviceId,
        packageId: body.packageId,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleAsyncReject(userId, body),
  });
}
