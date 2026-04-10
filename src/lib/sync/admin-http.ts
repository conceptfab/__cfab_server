import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/auth/admin-auth";
import { getEnv } from "@/lib/config/env";
import { internalServerError, isAppError } from "@/lib/http/error";
import { parseJsonBody } from "@/lib/http/request";
import { log, logError } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

function resolveCorsOrigin(request?: Request): string | null {
  const origin = request?.headers.get("origin")?.trim();
  if (!origin) return null;

  const env = getEnv();
  if (env.syncAllowedOrigins.length === 0 || env.syncAllowedOrigins.includes("*")) {
    return "*";
  }

  return env.syncAllowedOrigins.includes(origin) ? origin : null;
}

function buildHeaders(requestId: string, request?: Request): HeadersInit {
  const allowOrigin = resolveCorsOrigin(request);
  const corsHeaders: Record<string, string> = allowOrigin
    ? {
        "access-control-allow-origin": allowOrigin,
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, content-encoding, x-request-id",
        "access-control-expose-headers": REQUEST_ID_HEADER,
        ...(allowOrigin !== "*" ? { vary: "Origin" } : {}),
      }
    : {};

  return {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...corsHeaders,
  };
}

function responseFromError(error: unknown, requestId: string, request?: Request): NextResponse {
  const env = getEnv();
  const appError = isAppError(error) ? error : internalServerError();

  if (!isAppError(error)) {
    logError("admin.request.unhandled_error", error, { requestId });
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

export async function handleAdminOptions(request?: Request): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: buildHeaders("", request),
  });
}

export async function handleAdminPost<TBody, TResponse>(
  request: Request,
  route: string,
  parseBody: (body: unknown) => TBody,
  execute: (body: TBody) => Promise<TResponse>,
): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();

  try {
    authenticateAdminRequest(request);
    const parsed = await parseJsonBody(request, 1024 * 1024); // 1MB limit
    const body = parseBody(parsed.body);
    const result = await execute(body);

    log("info", "admin.request.success", {
      requestId,
      route,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json(result, { headers: buildHeaders(requestId, request) });
  } catch (error) {
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "admin.request.failure",
      {
        requestId,
        route,
        latencyMs: Date.now() - startedAt,
        ...(isAppError(error) ? { status: error.status, code: error.code } : {}),
      },
    );
    return responseFromError(error, requestId, request);
  }
}

export async function handleAdminGet<TResponse>(
  request: Request,
  route: string,
  execute: () => Promise<TResponse>,
): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();

  try {
    authenticateAdminRequest(request);
    const result = await execute();

    log("info", "admin.request.success", {
      requestId,
      route,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json(result, { headers: buildHeaders(requestId, request) });
  } catch (error) {
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "admin.request.failure",
      {
        requestId,
        route,
        latencyMs: Date.now() - startedAt,
        ...(isAppError(error) ? { status: error.status, code: error.code } : {}),
      },
    );
    return responseFromError(error, requestId, request);
  }
}

export async function handleAdminPatch<TBody, TResponse>(
  request: Request,
  route: string,
  parseBody: (body: unknown) => TBody,
  execute: (body: TBody) => Promise<TResponse>,
): Promise<NextResponse> {
  return handleAdminPost(request, route, parseBody, execute);
}

export async function handleAdminDelete(
  request: Request,
  route: string,
  execute: () => Promise<{ ok: true; deleted: boolean }>,
): Promise<NextResponse> {
  return handleAdminGet(request, route, execute);
}
