import { NextResponse } from "next/server";
import { healthCheck, createStorageAdapter } from "@/lib/sync/sftp-manager";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { getEnv } from "@/lib/config/env";
import { getAllStorageBackends } from "@/lib/sync/license-store";

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

  // Per-backend health checks
  const backends = await getAllStorageBackends();
  const backendStatuses: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    error: string | null;
  }> = [];

  for (const backend of backends) {
    try {
      const adapter = createStorageAdapter(backend);
      await adapter.healthCheck();
      backendStatuses.push({
        id: backend.id,
        name: backend.name,
        type: backend.type,
        status: "ok",
        error: null,
      });
    } catch (err) {
      backendStatuses.push({
        id: backend.id,
        name: backend.name,
        type: backend.type,
        status: "unavailable",
        error: env.isProduction ? null : (err instanceof Error ? err.message : String(err)),
      });
    }
  }

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
      storageBackends: backendStatuses,
    },
    {
      headers: {
        "x-request-id": requestId,
        "cache-control": "no-store",
      },
    },
  );
}
