export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleStatus } from "@/lib/sync/direct-sync";
import type { StatusBody, StatusResponse } from "@/lib/sync/direct-sync";
import { badRequest } from "@/lib/http/error";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<StatusBody, StatusResponse>(request, {
    route: "direct-status",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        clientRevision:
          typeof body.clientRevision === "number" ? body.clientRevision : 0,
        clientHash:
          typeof body.clientHash === "string" ? body.clientHash : null,
        tableHashes:
          body.tableHashes &&
          typeof body.tableHashes === "object"
            ? (body.tableHashes as StatusBody["tableHashes"])
            : undefined,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleStatus(userId, body),
  });
}
