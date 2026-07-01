// src/lib/auth/admin-auth.ts

import { createHash, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { forbidden, unauthorized } from "@/lib/http/error";
import {
  SYNC_DASHBOARD_AUTH_COOKIE,
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  getDashboardUserIdFromCookie,
} from "@/lib/auth/dashboard-page-auth";

/** Constant-time equality independent of input length (hash to fixed 32 bytes first). */
function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    map.set(key, val);
  }
  return map;
}

export function authenticateAdminRequest(request: Request): void {
  const env = getEnv();

  // 1) Try Bearer token auth
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    if (!env.adminApiToken) {
      throw forbidden("Admin API not configured", "admin_not_configured");
    }

    const token = authHeader.substring(7);

    if (!constantTimeEqual(token, env.adminApiToken)) {
      throw unauthorized("Invalid admin token", "invalid_admin_token");
    }
    return; // Bearer auth OK
  }

  // 2) Fallback: dashboard cookie auth (same-origin panel requests)
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    const cookieValue =
      cookies.get(SYNC_DASHBOARD_AUTH_COOKIE) ??
      cookies.get(LEGACY_SYNC_DASHBOARD_AUTH_COOKIE);
    if (cookieValue) {
      const userId = getDashboardUserIdFromCookie(cookieValue);
      if (userId) return; // Cookie auth OK
    }
  }

  throw unauthorized("Missing admin token or dashboard session", "missing_auth");
}
