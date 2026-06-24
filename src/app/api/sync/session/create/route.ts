import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionCreate } from "@/lib/sync/session-service";
import type { SessionCreateBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<SessionCreateBody, Awaited<ReturnType<typeof handleSessionCreate>>>(request, {
    route: "session-create",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required and must be a non-empty string");
      }
      if (body.deviceId.length > 128) {
        throw badRequest("deviceId too long (max 128 characters)");
      }
      return {
        deviceId: body.deviceId,
        markerHash: typeof body.markerHash === "string" ? body.markerHash : null,
        tableHashes: body.tableHashes && typeof body.tableHashes === "object" ? body.tableHashes as SessionCreateBody["tableHashes"] : null,
        forceFullSync: typeof body.forceFullSync === "boolean" ? body.forceFullSync : false,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleSessionCreate(userId, body),
    summarizeResult: (result) => ({
      sessionId: result.sessionId,
      role: result.role,
      status: result.status,
    }),
  });
}
