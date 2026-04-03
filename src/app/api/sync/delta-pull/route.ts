export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { getSnapshotForPull } from "@/lib/sync/online-sync-repository";
import { touchDeviceLastSeen } from "@/lib/sync/license-store";
import { badRequest } from "@/lib/http/error";

interface DeltaPullBody {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
}

interface DeltaPullResponse {
  ok: true;
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: Record<string, unknown>;
  reason: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<DeltaPullBody, DeltaPullResponse>(request, {
    route: "online-delta-pull",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
        throw badRequest("userId is required");
      }
      if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      return {
        userId: body.userId,
        deviceId: body.deviceId,
        clientRevision: typeof body.clientRevision === "number" ? body.clientRevision : null,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      void touchDeviceLastSeen(body.deviceId).catch(() => {});

      const result = await getSnapshotForPull(userId, body.clientRevision);
      return {
        ok: true as const,
        hasUpdate: result.hasUpdate,
        revision: result.revision,
        payloadSha256: result.payloadSha256,
        receivedAt: result.hasUpdate ? new Date().toISOString() : null,
        ...(result.archive ? { archive: result.archive } : {}),
        reason: result.reason,
      };
    },
    summarizeResult: (r) => ({
      hasUpdate: r.hasUpdate,
      revision: r.revision,
      reason: r.reason,
    }),
  });
}
