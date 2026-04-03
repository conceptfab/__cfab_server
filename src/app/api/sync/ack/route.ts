export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { acknowledgePull } from "@/lib/sync/online-sync-repository";
import { touchDeviceLastSeen, updateDeviceLastSync } from "@/lib/sync/license-store";
import { badRequest } from "@/lib/http/error";

interface AckBody {
  userId: string;
  deviceId: string;
  revision: number;
  payloadSha256: string;
}

interface AckResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  payloadSha256: string;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<AckBody, AckResponse>(request, {
    route: "online-ack",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
        throw badRequest("userId is required");
      }
      if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.revision !== "number") {
        throw badRequest("revision is required");
      }
      if (typeof body.payloadSha256 !== "string" || !body.payloadSha256.trim()) {
        throw badRequest("payloadSha256 is required");
      }
      return {
        userId: body.userId,
        deviceId: body.deviceId,
        revision: body.revision,
        payloadSha256: body.payloadSha256,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      void touchDeviceLastSeen(body.deviceId).catch(() => {});

      const result = await acknowledgePull(
        userId,
        body.revision,
        body.payloadSha256,
      );

      if (result.accepted) {
        void updateDeviceLastSync(body.deviceId, body.payloadSha256).catch(() => {});
      }

      return {
        ok: true as const,
        accepted: result.accepted,
        revision: body.revision,
        payloadSha256: body.payloadSha256,
        serverRevision: result.serverRevision,
        serverHash: result.serverHash,
        isLatest: result.isLatest,
        reason: result.reason,
      };
    },
    summarizeResult: (r) => ({
      accepted: r.accepted,
      isLatest: r.isLatest,
      reason: r.reason,
    }),
  });
}
