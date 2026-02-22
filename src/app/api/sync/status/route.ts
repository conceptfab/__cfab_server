import { NextResponse } from "next/server";

import { getSyncStatus, validateStatusRequest } from "@/lib/sync-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsed = validateStatusRequest(body);
    const response = await getSyncStatus(parsed);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      { status: 400 },
    );
  }
}

