export const runtime = "nodejs";

import { handleSyncPost, handleSyncOptions } from "@/lib/sync/http";

interface RefreshBody {
  deviceId: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<RefreshBody, { ok: true; message: string }>(request, {
    route: "session-status",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      return {
        deviceId: typeof body?.deviceId === "string" ? body.deviceId : "unknown",
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: async () => {
      // Token refresh: with token-based auth the token is static (mapped in env).
      // This endpoint exists for future auth modes (JWT, session-based).
      // For now, it validates the current token is still valid.
      return {
        ok: true as const,
        message: "Token is valid. Token refresh is not needed with static token auth.",
      };
    },
  });
}
