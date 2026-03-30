import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionHeartbeat } from "@/lib/sync/session-service";
import type { SessionHeartbeatBody } from "@/lib/sync/session-contracts";
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

  return handleSyncPost<SessionHeartbeatBody, Awaited<ReturnType<typeof handleSessionHeartbeat>>>(request, {
    route: "session-heartbeat",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required and must be a non-empty string");
      }
      const result: SessionHeartbeatBody = {
        deviceId: body.deviceId,
      };
      if (typeof body.currentStep === "number") {
        result.currentStep = body.currentStep;
      }
      if (body.transferProgress && typeof body.transferProgress === "object") {
        result.transferProgress = body.transferProgress as SessionHeartbeatBody["transferProgress"];
      }
      return result;
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleSessionHeartbeat(userId, id, body),
    summarizeResult: (result) => ({
      sessionStatus: result.sessionStatus,
      expiresAt: result.expiresAt,
    }),
  });
}
