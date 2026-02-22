import { NextResponse } from "next/server";

import { authenticateSyncRequest } from "@/lib/auth/server-auth";
import { getEnv } from "@/lib/config/env";
import { internalServerError, isAppError, tooManyRequests } from "@/lib/http/error";
import { getClientIp, parseJsonBody } from "@/lib/http/request";
import { log, logError } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";
import { checkRateLimit } from "@/lib/security/rate-limit";

type SyncRouteName = "status" | "push" | "pull";

interface SyncRouteSpec<TBody, TResponse> {
  route: SyncRouteName;
  parseBody: (body: unknown) => TBody;
  getBodyUserId: (body: TBody) => string | null | undefined;
  getDeviceId: (body: TBody) => string;
  execute: (args: { userId: string; body: TBody }) => Promise<TResponse>;
  summarizeResult?: (result: TResponse) => Record<string, unknown>;
}

function buildHeaders(requestId: string): HeadersInit {
  return {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

function responseFromError(error: unknown, requestId: string): NextResponse {
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
      headers: buildHeaders(requestId),
    },
  );
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
      headers: buildHeaders(requestId),
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

    return responseFromError(error, requestId);
  }
}

