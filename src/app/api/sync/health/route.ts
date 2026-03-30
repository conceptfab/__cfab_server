import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/sync/sftp-manager";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { getEnv } from "@/lib/config/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request);
  const env = getEnv();

  const sftpHealth = await healthCheck();

  const sftpStatus = sftpHealth.available
    ? "ok"
    : sftpHealth.error === "SFTP not configured"
      ? "not_configured"
      : "unavailable";

  // In production, don't leak raw SFTP error details publicly
  const errorMsg = env.isProduction ? null : sftpHealth.error;

  return NextResponse.json(
    {
      ok: true,
      server: "ok",
      sftp: {
        status: sftpStatus,
        lastCheck: sftpHealth.lastCheckAt,
        activeSessions: sftpHealth.activeSessions,
        error: errorMsg,
      },
    },
    {
      headers: {
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}
