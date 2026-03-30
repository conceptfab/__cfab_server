// src/lib/auth/admin-auth.ts

import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { forbidden, unauthorized } from "@/lib/http/error";

export function authenticateAdminRequest(request: Request): void {
  const env = getEnv();

  if (!env.adminApiToken) {
    throw forbidden("Admin API not configured", "admin_not_configured");
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw unauthorized("Missing admin token", "missing_admin_token");
  }

  const token = authHeader.substring(7);

  if (token.length !== env.adminApiToken.length) {
    throw unauthorized("Invalid admin token", "invalid_admin_token");
  }

  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(env.adminApiToken, "utf8");

  if (!timingSafeEqual(tokenBuf, expectedBuf)) {
    throw unauthorized("Invalid admin token", "invalid_admin_token");
  }
}
