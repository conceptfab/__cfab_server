import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { forbidden, unauthorized } from "@/lib/http/error";

export interface SyncAuthContext {
  userId: string;
  method: "token" | "dev-body-userid";
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") {
    throw unauthorized("Authorization header must use Bearer token");
  }

  const token = rest.join(" ").trim();
  if (!token) {
    throw unauthorized("Bearer token is missing");
  }
  return token;
}

function resolveUserByToken(token: string): string | null {
  const env = getEnv();

  for (const [userId, expectedToken] of env.syncApiTokens.entries()) {
    if (safeStringEqual(token, expectedToken)) {
      return userId;
    }
  }

  return null;
}

export function authenticateSyncRequest(
  request: Request,
  bodyUserId?: string | null,
): SyncAuthContext {
  const env = getEnv();

  if (env.syncAuthMode === "session") {
    throw unauthorized(
      "SYNC_AUTH_MODE=session is not implemented yet on this server",
      "auth_mode_not_implemented",
    );
  }

  const token = getBearerToken(request);
  if (token) {
    const userId = resolveUserByToken(token);
    if (!userId) {
      throw unauthorized("Invalid API token", "invalid_token");
    }
    if (bodyUserId && bodyUserId !== userId) {
      throw forbidden("Body userId does not match token user", "user_mismatch");
    }
    return { userId, method: "token" };
  }

  if (env.syncAllowInsecureDevUserIdFallback && bodyUserId) {
    return { userId: bodyUserId, method: "dev-body-userid" };
  }

  throw unauthorized("Missing Bearer token");
}

