export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAck } from "@/lib/sync/direct-sync";
import type { AckBody, AckResponse } from "@/lib/sync/direct-sync";
import { badRequest } from "@/lib/http/error";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<AckBody, AckResponse>(request, {
    route: "direct-ack",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.revision !== "number") {
        throw badRequest("revision is required");
      }
      if (typeof body.payloadSha256 !== "string") {
        throw badRequest("payloadSha256 is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        revision: body.revision,
        payloadSha256: body.payloadSha256,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleAck(userId, body),
  });
}
