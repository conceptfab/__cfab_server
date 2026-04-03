export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleTestRoundtrip } from "@/lib/sync/direct-sync";
import type {
  TestRoundtripBody,
  TestRoundtripResponse,
} from "@/lib/sync/direct-sync";
import { badRequest } from "@/lib/http/error";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<TestRoundtripBody, TestRoundtripResponse>(request, {
    route: "direct-status",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (!body.testPayload || typeof body.testPayload !== "object") {
        throw badRequest("testPayload is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        testPayload: body.testPayload as Record<string, unknown>,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleTestRoundtrip(userId, body),
  });
}
