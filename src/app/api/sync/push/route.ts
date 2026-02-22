import { NextResponse } from "next/server";

import { pushSnapshot, validatePushRequest } from "@/lib/sync-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsed = validatePushRequest(body);
    const response = await pushSnapshot(parsed);
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

