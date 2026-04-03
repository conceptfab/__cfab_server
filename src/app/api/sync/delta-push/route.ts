export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { applyDeltaPush } from "@/lib/sync/online-sync-repository";
import { touchDeviceLastSeen, updateDeviceLastSync } from "@/lib/sync/license-store";
import { notifyPeers } from "@/lib/sync/event-bus";
import { badRequest } from "@/lib/http/error";
import type { TableHashes, DeltaData } from "@/lib/sync/contracts";

interface DeltaPushBody {
  userId: string;
  deviceId: string;
  baseRevision: number;
  tableHashes: TableHashes;
  delta: DeltaData;
}

interface DeltaPushResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<DeltaPushBody, DeltaPushResponse>(request, {
    route: "online-delta-push",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
        throw badRequest("userId is required");
      }
      if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.baseRevision !== "number") {
        throw badRequest("baseRevision is required");
      }
      if (!body.tableHashes || typeof body.tableHashes !== "object") {
        throw badRequest("tableHashes is required");
      }
      if (!body.delta || typeof body.delta !== "object") {
        throw badRequest("delta is required");
      }
      return {
        userId: body.userId,
        deviceId: body.deviceId,
        baseRevision: body.baseRevision,
        tableHashes: body.tableHashes as TableHashes,
        delta: body.delta as DeltaData,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      void touchDeviceLastSeen(body.deviceId).catch(() => {});

      const result = await applyDeltaPush(
        userId,
        body.delta,
        body.baseRevision,
        body.tableHashes,
        body.deviceId,
      );

      if (result.accepted) {
        void updateDeviceLastSync(body.deviceId).catch(() => {});

        notifyPeers({
          type: "sync_available",
          userId,
          sourceDeviceId: body.deviceId,
          revision: result.revision,
          reason: "delta_pushed",
          timestamp: new Date().toISOString(),
        });
      }

      return { ok: true as const, ...result };
    },
    summarizeResult: (r) => ({
      accepted: r.accepted,
      revision: r.revision,
      reason: r.reason,
    }),
  });
}
