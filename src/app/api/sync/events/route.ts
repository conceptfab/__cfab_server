import { authenticateSyncRequest } from "@/lib/auth/server-auth";
import { subscribe, type SyncEvent } from "@/lib/sync/event-bus";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";
// SSE connections must not be cached or buffered
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/events?deviceId=xxx
 *
 * Server-Sent Events stream that pushes `sync_available` notifications
 * to connected clients whenever another device pushes new data.
 *
 * Authentication: Bearer token in Authorization header (same as other sync endpoints).
 * Query params:
 *   - deviceId (required): the connecting device's ID (so we don't echo back to sender)
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  const url = new URL(request.url);

  // Authenticate — try Authorization header first, then ?token= query param
  // (EventSource API doesn't support custom headers)
  let userId: string;
  try {
    const queryToken = url.searchParams.get("token");
    const reqWithAuth = queryToken && !request.headers.get("authorization")
      ? new Request(request.url, {
          headers: { ...Object.fromEntries(request.headers), authorization: `Bearer ${queryToken}` },
        })
      : request;
    const auth = authenticateSyncRequest(reqWithAuth, null);
    userId = auth.userId;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: requestId },
    });
  }

  // Parse deviceId from query
  const deviceId = url.searchParams.get("deviceId");
  if (!deviceId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing deviceId query param" }), {
      status: 400,
      headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: requestId },
    });
  }

  log("info", "sync.sse.connected", { requestId, userId, deviceId });

  // Create SSE stream
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ ok: true, userId, deviceId })}\n\n`),
      );

      // Subscribe to sync events for this user
      unsubscribe = subscribe(userId, deviceId, (event: SyncEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: sync_available\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Stream closed
        }
      });

      // Keep-alive ping every 30s to prevent proxy/load-balancer timeouts
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // Stream closed
        }
      }, 30_000);
    },
    cancel() {
      log("info", "sync.sse.disconnected", { requestId, userId, deviceId });
      if (unsubscribe) unsubscribe();
      if (keepAliveTimer) clearInterval(keepAliveTimer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx proxy buffering off
      [REQUEST_ID_HEADER]: requestId,
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-request-id",
    },
  });
}
