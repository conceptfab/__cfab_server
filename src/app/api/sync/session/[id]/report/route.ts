import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionReport } from "@/lib/sync/session-service";
import type { SessionReportBody } from "@/lib/sync/session-contracts";
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

  return handleSyncPost<SessionReportBody, Awaited<ReturnType<typeof handleSessionReport>>>(request, {
    route: "session-report",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.step !== "number") {
        throw badRequest("step is required and must be a number");
      }
      if (typeof body.action !== "string" || !body.action.trim()) {
        throw badRequest("action is required and must be a non-empty string");
      }
      if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required and must be a non-empty string");
      }
      const status = (body.status as string) ?? "ok";
      if (status !== "ok" && status !== "error" && status !== "warning") {
        throw badRequest("status must be 'ok', 'error', or 'warning'");
      }
      return {
        step: body.step,
        action: body.action,
        deviceId: body.deviceId,
        details: (body.details && typeof body.details === "object" ? body.details : {}) as Record<string, unknown>,
        status,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleSessionReport(userId, id, body),
    summarizeResult: (result) => ({
      acknowledged: result.acknowledged,
      currentStep: result.currentStep,
      sessionStatus: result.sessionStatus,
    }),
  });
}
