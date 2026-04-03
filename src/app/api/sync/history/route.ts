export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { validateTokenSyncAuth } from "@/lib/sync/http";
import { getSyncHistoryForUser } from "@/lib/sync/session-store";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request);
  const userId = await validateTokenSyncAuth(request);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  const { entries, total } = await getSyncHistoryForUser(userId, limit, offset);

  return NextResponse.json(
    { ok: true, entries, total, limit, offset },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
