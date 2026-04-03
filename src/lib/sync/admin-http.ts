import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/auth/admin-auth";
import { getEnv } from "@/lib/config/env";
import { internalServerError, isAppError } from "@/lib/http/error";
import { parseJsonBody } from "@/lib/http/request";
import { log, logError } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

function buildHeaders(requestId: string): HeadersInit {
  return {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, content-encoding, x-request-id",
    "access-control-expose-headers": REQUEST_ID_HEADER,
  };
}

function responseFromError(error: unknown, requestId: string): NextResponse {
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
      headers: buildHeaders(requestId),
    },
  );
}

export async function handleAdminOptions(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: buildHeaders(""),
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

    return NextResponse.json(result, { headers: buildHeaders(requestId) });
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
    return responseFromError(error, requestId);
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

    return NextResponse.json(result, { headers: buildHeaders(requestId) });
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
    return responseFromError(error, requestId);
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
