export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { validateTokenSyncAuth } from "@/lib/sync/http";
import { getSyncHistoryEntry, getSession } from "@/lib/sync/session-store";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const userId = await validateTokenSyncAuth(request);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const { id } = await params;
  const entry = await getSyncHistoryEntry(id);
  if (!entry) {
    return NextResponse.json(
      { ok: false, error: "History entry not found" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  // Get the session for step log details
  const session = await getSession(entry.sessionId);
  const stepLog = session?.stepLog ?? [];

  return NextResponse.json(
    { ok: true, entry, stepLog },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
