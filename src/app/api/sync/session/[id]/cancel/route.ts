import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionCancel } from "@/lib/sync/session-service";
import type { SessionCancelBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return handleSyncPost<SessionCancelBody, Awaited<ReturnType<typeof handleSessionCancel>>>(request, {
    route: "session-cancel",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required and must be a non-empty string");
      }
      const result: SessionCancelBody = {
        deviceId: body.deviceId,
      };
      if (typeof body.reason === "string") {
        result.reason = body.reason;
      }
      return result;
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleSessionCancel(userId, id, body),
    summarizeResult: (result) => ({
      cancelled: result.cancelled,
      sessionId: result.sessionId,
    }),
  });
}
