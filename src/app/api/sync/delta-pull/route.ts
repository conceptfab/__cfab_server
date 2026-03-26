import { NextResponse } from "next/server";
import { z } from "zod";

import { pullSnapshot } from "@/lib/sync/service";
import type { SyncPullRequest } from "@/lib/sync/contracts";
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

const PullSchema = z.object({
  userId: z.string(),
  deviceId: z.string(),
  clientRevision: z.number().nullable(),
});

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "pull",
    parseBody: (body) => PullSchema.parse(body),
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      pullSnapshot({
        userId,
        deviceId: body.deviceId,
        clientRevision: body.clientRevision,
      }),
  });
}
