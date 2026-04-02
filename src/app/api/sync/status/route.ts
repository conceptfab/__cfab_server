export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { checkSyncStatus } from "@/lib/sync/online-sync-repository";
import { touchDeviceLastSeen } from "@/lib/sync/license-store";
import { badRequest } from "@/lib/http/error";

interface StatusBody {
  userId: string;
  deviceId: string;
  clientRevision: number | null;
  clientHash: string | null;
  tableHashes?: Record<string, string> | null;
}

interface StatusResponse {
  ok: true;
  serverRevision: number;
  serverHash: string | null;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
  dirtyTables?: string[];
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<StatusBody, StatusResponse>(request, {
    route: "online-status",
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
        clientHash: typeof body.clientHash === "string" ? body.clientHash : null,
        tableHashes: (body.tableHashes && typeof body.tableHashes === "object")
          ? body.tableHashes as Record<string, string>
          : null,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      // Fire-and-forget: update device lastSeenAt
      void touchDeviceLastSeen(body.deviceId).catch(() => {});

      const result = await checkSyncStatus(
        userId,
        body.clientRevision,
        body.clientHash,
        body.tableHashes as any,
      );
      return { ok: true as const, ...result };
    },
    summarizeResult: (r) => ({
      reason: r.reason,
      shouldPush: r.shouldPush,
      shouldPull: r.shouldPull,
      serverRevision: r.serverRevision,
    }),
  });
}
