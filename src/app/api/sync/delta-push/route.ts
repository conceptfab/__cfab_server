import { NextResponse } from "next/server";
import { z } from "zod";

import { pushDelta } from "@/lib/sync/service";
import type { SyncDeltaPushRequest } from "@/lib/sync/contracts";
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

const TableHashesSchema = z.object({
  projects: z.string(),
  applications: z.string(),
  sessions: z.string(),
  manual_sessions: z.string(),
});

const DeltaPushSchema = z.object({
  userId: z.string(),
  deviceId: z.string(),
  baseRevision: z.number(),
  tableHashes: TableHashesSchema,
  delta: z.object({
      projects: z.array(z.any()),
      applications: z.array(z.any()),
      sessions: z.array(z.any()),
      manual_sessions: z.array(z.any()),
      tombstones: z.array(z.object({
          table_name: z.string(),
          record_id: z.string(),
          record_uuid: z.string(),
          deleted_at: z.string(),
          sync_key: z.string(),
      })),
  }),
});

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "push",
    parseBody: (body) => DeltaPushSchema.parse(body),
    getBodyUserId: (body) => body.userId,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      pushDelta({
        userId,
        deviceId: body.deviceId,
        baseRevision: body.baseRevision,
        tableHashes: body.tableHashes,
        delta: body.delta,
      }),
  });
}
