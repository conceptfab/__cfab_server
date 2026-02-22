import { handleSyncPost } from "@/lib/sync/http";
import { pullSnapshot } from "@/lib/sync/service";
import { validatePullBody } from "@/lib/sync/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "pull",
    parseBody: validatePullBody,
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      pullSnapshot({
        userId,
        deviceId: body.deviceId,
        clientRevision: body.clientRevision,
      }),
    summarizeResult: (result) => {
      if (
        typeof result === "object" &&
        result !== null &&
        "reason" in result &&
        "hasUpdate" in result
      ) {
        return {
          resultReason: result.reason,
          hasUpdate: result.hasUpdate,
        };
      }
      return {};
    },
  });
}
