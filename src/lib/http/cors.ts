import { getEnv } from "@/lib/config/env";

/**
 * Resolves the `access-control-allow-origin` value for a request, honoring
 * SYNC_ALLOWED_ORIGINS. Returns null when the request origin is not allowed
 * (caller should then omit CORS headers). "*" only when explicitly configured
 * (empty allow-list or "*").
 */
export function resolveAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;

  const env = getEnv();
  if (env.syncAllowedOrigins.length === 0 || env.syncAllowedOrigins.includes("*")) {
    return "*";
  }
  return env.syncAllowedOrigins.includes(origin) ? origin : null;
}

/** Builds CORS headers for the given request/methods, or {} when origin not allowed. */
export function buildCorsHeaders(
  request: Request,
  methods: string,
  extraAllowHeaders = "content-type, x-request-id",
): Record<string, string> {
  const allowOrigin = resolveAllowedOrigin(request);
  if (!allowOrigin) return {};
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": methods,
    "access-control-allow-headers": extraAllowHeaders,
    ...(allowOrigin !== "*" ? { vary: "Origin" } : {}),
  };
}
