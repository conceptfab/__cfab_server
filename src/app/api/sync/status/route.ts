import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { getSyncStatus } from "@/lib/sync/service";
import { validateStatusBody } from "@/lib/sync/validation";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "status",
    parseBody: validateStatusBody,
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      getSyncStatus({
        userId,
        deviceId: body.deviceId,
        clientRevision: body.clientRevision,
        clientHash: body.clientHash,
      }),
    summarizeResult: (result) => {
      if (
        typeof result === "object" &&
        result !== null &&
        "reason" in result &&
        "shouldPush" in result &&
        "shouldPull" in result
      ) {
        return {
          resultReason: result.reason,
          shouldPush: result.shouldPush,
          shouldPull: result.shouldPull,
        };
      }
      return {};
    },
  });
}
