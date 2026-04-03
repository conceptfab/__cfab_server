export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { validateTokenSyncAuth } from "@/lib/sync/http";
import { getDevice } from "@/lib/sync/license-store";
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
  const device = await getDevice(id);
  if (!device) {
    return NextResponse.json(
      { ok: false, error: "Device not found" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  return NextResponse.json(
    { ok: true, device },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
