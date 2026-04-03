export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { saveFullSnapshot } from "@/lib/sync/online-sync-repository";
import { touchDeviceLastSeen, updateDeviceLastSync } from "@/lib/sync/license-store";
import { badRequest } from "@/lib/http/error";

interface PushBody {
  userId: string;
  deviceId: string;
  knownServerRevision: number | null;
  archive: Record<string, unknown>;
}

interface PushResponse {
  ok: true;
  accepted: boolean;
  noOp: boolean;
  revision: number;
  payloadSha256: string;
  receivedAt: string;
  reason: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<PushBody, PushResponse>(request, {
    route: "online-push",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
        throw badRequest("userId is required");
      }
      if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (!body.archive || typeof body.archive !== "object") {
        throw badRequest("archive is required");
      }
      return {
        userId: body.userId,
        deviceId: body.deviceId,
        knownServerRevision: typeof body.knownServerRevision === "number"
          ? body.knownServerRevision
          : null,
        archive: body.archive as Record<string, unknown>,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      void touchDeviceLastSeen(body.deviceId).catch(() => {});

      const result = await saveFullSnapshot(
        userId,
        body.archive,
        body.deviceId,
        null,
      );

      // Update device sync tracking
      void updateDeviceLastSync(body.deviceId, result.payloadSha256).catch(() => {});

      const noOp = result.payloadSha256 === result.payloadSha256; // always true for full push
      return {
        ok: true as const,
        accepted: true,
        noOp: false,
        revision: result.revision,
        payloadSha256: result.payloadSha256,
        receivedAt: new Date().toISOString(),
        reason: "push_accepted",
      };
    },
    summarizeResult: (r) => ({
      revision: r.revision,
      noOp: r.noOp,
    }),
  });
}
