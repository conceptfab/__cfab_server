import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { ackPulledSnapshot } from "@/lib/sync/service";
import { validateAckBody } from "@/lib/sync/validation";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "ack",
    parseBody: validateAckBody,
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      ackPulledSnapshot({
        userId,
        deviceId: body.deviceId,
        revision: body.revision,
        payloadSha256: body.payloadSha256,
      }),
    summarizeResult: (result) => {
      if (
        typeof result === "object" &&
        result !== null &&
        "reason" in result &&
        "accepted" in result &&
        "isLatest" in result
      ) {
        return {
          resultReason: result.reason,
          accepted: result.accepted,
          isLatest: result.isLatest,
        };
      }
      return {};
    },
  });
}
