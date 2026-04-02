export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAsyncPending } from "@/lib/sync/async-delta";
import type { AsyncPendingResponse } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

interface PendingBody {
  deviceId: string;
  groupId: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<PendingBody, AsyncPendingResponse>(request, {
    route: "async-pending",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.groupId !== "string" || !body.groupId.trim()) {
        throw badRequest("groupId is required");
      }
      return {
        deviceId: body.deviceId,
        groupId: body.groupId,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleAsyncPending(userId, body.deviceId, body.groupId),
  });
}
