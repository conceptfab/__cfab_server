import { NextResponse } from "next/server";
import { z } from "zod";

import { pullSnapshot } from "@/lib/sync/service";
import type { SyncPullRequest } from "@/lib/sync/contracts";
import { validateTokenSyncAuth } from "@/lib/sync/http";

const PullSchema = z.object({
  deviceId: z.string(),
  clientRevision: z.number().nullable(),
});

export async function POST(request: Request) {
  try {
    const userId = await validateTokenSyncAuth(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyText = await request.text();
    const bodyJson = JSON.parse(bodyText);
    const parsed = PullSchema.safeParse(bodyJson);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload format", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const { deviceId, clientRevision } = parsed.data;

    const reqData: SyncPullRequest = {
      userId,
      deviceId,
      clientRevision,
    };

    const resData = await pullSnapshot(reqData);
    return NextResponse.json(resData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
