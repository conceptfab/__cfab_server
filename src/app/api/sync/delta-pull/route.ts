export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleDeltaPull } from "@/lib/sync/direct-sync";
import type {
  DeltaPullBody,
  DeltaPullResponse,
} from "@/lib/sync/direct-sync";
import { badRequest } from "@/lib/http/error";
import { isLegacyDirectSyncEnabled } from "@/lib/sync/legacy-gate";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  if (!isLegacyDirectSyncEnabled()) {
    return NextResponse.json(
      { ok: false, error: "legacy_direct_sync_disabled" },
      { status: 410, headers: { "cache-control": "no-store" } },
    );
  }
  return handleSyncPost<DeltaPullBody, DeltaPullResponse>(request, {
    route: "direct-delta-pull",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        clientRevision:
          typeof body.clientRevision === "number" ? body.clientRevision : 0,
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleDeltaPull(userId, body),
  });
}
