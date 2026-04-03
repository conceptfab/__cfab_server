export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleDeltaPush } from "@/lib/sync/direct-sync";
import type {
  DeltaPushBody,
  DeltaPushResponse,
} from "@/lib/sync/direct-sync";
import { badRequest } from "@/lib/http/error";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<DeltaPushBody, DeltaPushResponse>(request, {
    route: "direct-delta-push",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (!body.delta || typeof body.delta !== "object") {
        throw badRequest("delta is required");
      }
      if (!body.tableHashes || typeof body.tableHashes !== "object") {
        throw badRequest("tableHashes is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        tableHashes: body.tableHashes as DeltaPushBody["tableHashes"],
        baseRevision:
          typeof body.baseRevision === "number" ? body.baseRevision : 0,
        delta: body.delta as DeltaPushBody["delta"],
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleDeltaPush(userId, body),
  });
}
