import { NextResponse } from "next/server";
import { z } from "zod";

import { pushDelta } from "@/lib/sync/service";
import type { SyncDeltaPushRequest } from "@/lib/sync/contracts";
import { validateTokenSyncAuth, handleSyncOptions } from "@/lib/sync/http";

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
  try {
    const userId = await validateTokenSyncAuth(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyText = await request.text();
    const bodyJson = JSON.parse(bodyText);
    const parsed = DeltaPushSchema.safeParse(bodyJson);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload format", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const { deviceId, baseRevision, tableHashes, delta } = parsed.data;

    const reqData: SyncDeltaPushRequest = {
      userId,
      deviceId,
      baseRevision,
      tableHashes,
      delta,
    };

    const resData = await pushDelta(reqData);
    return NextResponse.json(resData);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Revision mismatch")) {
         return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
