export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { validateTokenSyncAuth } from "@/lib/sync/http";
import { getDevicesForUser } from "@/lib/sync/license-store";
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

  const devices = await getDevicesForUser(userId);

  return NextResponse.json(
    { ok: true, devices, total: devices.length },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
