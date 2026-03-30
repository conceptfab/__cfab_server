import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/sync/sftp-manager";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request);

  const sftpHealth = await healthCheck();

  const sftpStatus = sftpHealth.available
    ? "ok"
    : sftpHealth.error === "SFTP not configured"
      ? "not_configured"
      : "unavailable";

  return NextResponse.json(
    {
      ok: true,
      server: "ok",
      sftp: {
        status: sftpStatus,
        lastCheck: sftpHealth.lastCheckAt,
        activeSessions: sftpHealth.activeSessions,
        error: sftpHealth.error,
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
