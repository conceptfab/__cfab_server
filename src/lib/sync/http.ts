import { NextResponse } from "next/server";

import { authenticateSyncRequest } from "@/lib/auth/server-auth";
import { getEnv } from "@/lib/config/env";
import { internalServerError, isAppError, tooManyRequests } from "@/lib/http/error";
import { getClientIp, parseJsonBody } from "@/lib/http/request";
import { log, logError } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { checkRateLimit } from "@/lib/security/rate-limit";

type SyncRouteName =
  | "session-create"
  | "session-status"
  | "session-report"
  | "session-heartbeat"
  | "session-cancel"
  | "async-push"
  | "async-pending"
  | "async-ack"
  | "async-reject"
  | "direct-status"
  | "direct-push"
  | "direct-delta-pull"
  | "direct-delta-push"
  | "direct-ack";

export async function validateTokenSyncAuth(request: Request): Promise<string | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    const token = authHeader.substring(7);
    try {
        // reuse standard auth strategy without body requirements
        const auth = authenticateSyncRequest(request, null);
        return auth.userId;
    } catch {
       return null;
    }
}

interface SyncRouteSpec<TBody, TResponse> {
  route: SyncRouteName;
  parseBody: (body: unknown) => TBody;
  getBodyUserId: (body: TBody) => string | null | undefined;
  getDeviceId: (body: TBody) => string;
  execute: (args: { userId: string; body: TBody }) => Promise<TResponse>;
  summarizeResult?: (result: TResponse) => Record<string, unknown>;
}

function resolveCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;

  const env = getEnv();
  if (env.syncAllowedOrigins.length === 0 || env.syncAllowedOrigins.includes("*")) {
    return "*";
  }

  return env.syncAllowedOrigins.includes(origin) ? origin : null;
}

function buildCorsHeaders(request: Request): HeadersInit {
  const allowOrigin = resolveCorsOrigin(request);
  if (!allowOrigin) {
    return {};
  }

  const headers: Record<string, string> = {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-request-id",
    "access-control-expose-headers": REQUEST_ID_HEADER,
    "access-control-max-age": "600",
  };

  if (allowOrigin !== "*") {
    headers.vary = "Origin";
  }

  return headers;
}

function buildHeaders(requestId: string, request?: Request): HeadersInit {
  return {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(request ? buildCorsHeaders(request) : {}),
  };
}

function responseFromError(error: unknown, requestId: string, request: Request): NextResponse {
  const env = getEnv();
  const appError = isAppError(error) ? error : internalServerError();

  if (!isAppError(error)) {
    logError("sync.request.unhandled_error", error, { requestId });
  }

  return NextResponse.json(
    {
      ok: false,
      code: appError.code,
      error: appError.expose || !env.isProduction ? appError.message : "Internal server error",
      requestId,
      ...(appError.details ? { details: appError.details } : {}),
    },
    {
      status: appError.status,
      headers: buildHeaders(requestId, request),
    },
  );
}

export async function handleSyncOptions(request: Request): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request);
  return new NextResponse(null, {
    status: 204,
    headers: buildHeaders(requestId, request),
  });
}

export async function handleSyncPost<TBody, TResponse>(
  request: Request,
  spec: SyncRouteSpec<TBody, TResponse>,
): Promise<NextResponse> {
  const env = getEnv();
  const requestId = getOrCreateRequestId(request);
  const clientIp = getClientIp(request);
  const startedAt = Date.now();

  let userIdForLogs: string | null = null;
  let deviceIdForLogs: string | null = null;
  let rawBytes = 0;

  try {
    const parsed = await parseJsonBody(request, env.syncMaxPayloadBytes);
    rawBytes = parsed.rawBytes;

    const body = spec.parseBody(parsed.body);
    const bodyUserId = spec.getBodyUserId(body) ?? null;
    deviceIdForLogs = spec.getDeviceId(body);

    const auth = authenticateSyncRequest(request, bodyUserId);
    userIdForLogs = auth.userId;

    const rateLimitKey = [
      "sync",
      spec.route,
      auth.userId,
      clientIp ?? "unknown-ip",
    ].join(":");
    const rate = checkRateLimit(
      rateLimitKey,
      env.syncRateLimitMaxRequests,
      env.syncRateLimitWindowMs,
    );
    if (!rate.allowed) {
      throw tooManyRequests("Rate limit exceeded", "rate_limited", {
        retryAfterMs: rate.retryAfterMs,
      });
    }

    const result = await spec.execute({
      userId: auth.userId,
      body,
    });

    const latencyMs = Date.now() - startedAt;
    log("info", "sync.request.success", {
      requestId,
      route: spec.route,
      authMethod: auth.method,
      userId: auth.userId,
      deviceId: deviceIdForLogs,
      ip: clientIp,
      latencyMs,
      rawBytes,
      ...(spec.summarizeResult ? spec.summarizeResult(result) : {}),
    });

    return NextResponse.json(result, {
      headers: buildHeaders(requestId, request),
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "sync.request.failure",
      {
        requestId,
        route: spec.route,
        userId: userIdForLogs,
        deviceId: deviceIdForLogs,
        ip: clientIp,
        latencyMs,
        rawBytes,
        ...(isAppError(error)
          ? {
              status: error.status,
              code: error.code,
              message: error.message,
            }
          : {}),
      },
    );

    return responseFromError(error, requestId, request);
  }
}

// ---------------------------------------------------------------------------
// GET handler (no body parsing)
// ---------------------------------------------------------------------------

interface SyncGetRouteSpec<TResponse> {
  route: SyncRouteName;
  extractParams: (request: Request, url: URL) => Record<string, string>;
  execute: (params: Record<string, string> & { userId: string }) => Promise<TResponse>;
  summarizeResult?: (result: TResponse) => Record<string, unknown>;
}

export async function handleSyncGet<TResponse>(
  request: Request,
  spec: SyncGetRouteSpec<TResponse>,
): Promise<NextResponse> {
  const env = getEnv();
  const requestId = getOrCreateRequestId(request);
  const clientIp = getClientIp(request);
  const startedAt = Date.now();

  let userIdForLogs: string | null = null;

  try {
    const url = new URL(request.url);
    const params = spec.extractParams(request, url);

    const auth = authenticateSyncRequest(request, null);
    userIdForLogs = auth.userId;

    const rateLimitKey = [
      "sync",
      spec.route,
      auth.userId,
      clientIp ?? "unknown-ip",
    ].join(":");
    const rate = checkRateLimit(
      rateLimitKey,
      env.syncRateLimitMaxRequests,
      env.syncRateLimitWindowMs,
    );
    if (!rate.allowed) {
      throw tooManyRequests("Rate limit exceeded", "rate_limited", {
        retryAfterMs: rate.retryAfterMs,
      });
    }

    const result = await spec.execute({
      ...params,
      userId: auth.userId,
    });

    const latencyMs = Date.now() - startedAt;
    log("info", "sync.request.success", {
      requestId,
      route: spec.route,
      authMethod: auth.method,
      userId: auth.userId,
      ip: clientIp,
      latencyMs,
      ...(spec.summarizeResult ? spec.summarizeResult(result) : {}),
    });

    return NextResponse.json(result, {
      headers: buildHeaders(requestId, request),
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "sync.request.failure",
      {
        requestId,
        route: spec.route,
        userId: userIdForLogs,
        ip: clientIp,
        latencyMs,
        ...(isAppError(error)
          ? {
              status: error.status,
              code: error.code,
              message: error.message,
            }
          : {}),
      },
    );

    return responseFromError(error, requestId, request);
  }
}
