import { NextResponse } from "next/server";

import { runSessionCleanup } from "@/lib/sync/session-cleanup";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const runtime = "nodejs";
// Cron-triggered; never cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/session-cleanup
 *
 * Invoked by Vercel Cron (see vercel.json). Replaces the in-process setInterval
 * timer, which does not run reliably on serverless. Authenticated with
 * CRON_SECRET: Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when the env var is set.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      log("warn", "cron.session-cleanup.unauthorized", { requestId });
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: { [REQUEST_ID_HEADER]: requestId, "cache-control": "no-store" } },
      );
    }
  }

  try {
    const result = await runSessionCleanup();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { [REQUEST_ID_HEADER]: requestId, "cache-control": "no-store" } },
    );
  } catch (error) {
    log("error", "cron.session-cleanup.error", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "cleanup_failed" },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId, "cache-control": "no-store" } },
    );
  }
}
