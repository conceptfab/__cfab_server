export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handlePush } from "@/lib/sync/direct-sync";
import type { PushBody, PushResponse } from "@/lib/sync/direct-sync";
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
  return handleSyncPost<PushBody, PushResponse>(request, {
    route: "direct-push",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (!body.archive || typeof body.archive !== "object") {
        throw badRequest("archive is required");
      }
      return {
        userId: typeof body.userId === "string" ? body.userId : "",
        deviceId: body.deviceId,
        knownServerRevision:
          typeof body.knownServerRevision === "number"
            ? body.knownServerRevision
            : null,
        archive: body.archive as PushBody["archive"],
      };
    },
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handlePush(userId, body),
  });
}
