import { handleSyncGet, handleSyncOptions } from "@/lib/sync/http";
import { handleSessionStatus } from "@/lib/sync/session-service";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId") ?? "";

  return handleSyncGet(request, {
    route: "session-status",
    extractParams: () => ({ sessionId: id, deviceId }),
    execute: ({ userId }) => handleSessionStatus(userId, id, deviceId),
    summarizeResult: (result) => ({
      sessionId: result.sessionId,
      status: result.status,
      myRole: result.myRole,
    }),
  });
}
