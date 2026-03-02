import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { pushSnapshot } from "@/lib/sync/service";
import { validatePushBody } from "@/lib/sync/validation";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "push",
    parseBody: validatePushBody,
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      pushSnapshot({
        userId,
        deviceId: body.deviceId,
        knownServerRevision: body.knownServerRevision,
        archive: body.archive,
      }),
    summarizeResult: (result) => {
      if (
        typeof result === "object" &&
        result !== null &&
        "reason" in result &&
        "noOp" in result &&
        "revision" in result
      ) {
        return {
          resultReason: result.reason,
          noOp: result.noOp,
          revision: result.revision,
        };
      }
      return {};
    },
  });
}
