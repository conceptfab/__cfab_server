import { NextResponse } from "next/server";

import { getEnv } from "@/lib/config/env";
import { log } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request);
  const env = getEnv();
  const now = new Date().toISOString();

  log("debug", "health.check", { requestId });

  return NextResponse.json(
    {
      ok: true,
      status: "healthy",
      service: "timeflow-sync-server",
      time: now,
      authMode: env.syncAuthMode,
      encryptionMode: env.encryptionMode,
      storageMode: "postgres",
      databaseConfigured: Boolean(env.databaseUrl),
    },
    {
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "cache-control": "no-store",
      },
    },
  );
}


