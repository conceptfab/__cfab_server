export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAsyncSentCleanup } from "@/lib/sync/async-delta";
import type { AsyncSentCleanupResponse } from "@/lib/sync/async-delta";
import { badRequest } from "@/lib/http/error";

interface SentCleanupBody {
  deviceId: string;
  groupId: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<SentCleanupBody, AsyncSentCleanupResponse>(request, {
    route: "async-sent-cleanup",
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
    execute: ({ userId, body }) => handleAsyncSentCleanup(userId, body.deviceId, body.groupId),
  });
}
