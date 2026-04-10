import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { forbidden, unauthorized } from "@/lib/http/error";
import { findDeviceByToken } from "@/lib/sync/license-store";

export interface SyncAuthContext {
  userId: string;
  method: "token" | "device-token" | "dev-body-userid";
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

// Reverse index: token → userId for O(1) lookup
// Cached and rebuilt only when the source token map changes.
let cachedReverseMap: Map<string, string> | null = null;
let cachedReverseSource: Map<string, string> | null = null;

function getReverseTokenMap(apiTokens: Map<string, string>): Map<string, string> {
  if (cachedReverseMap && cachedReverseSource === apiTokens) {
    return cachedReverseMap;
  }
  const reverse = new Map<string, string>();
  for (const [userId, tok] of apiTokens.entries()) {
    reverse.set(tok, userId);
  }
  cachedReverseMap = reverse;
  cachedReverseSource = apiTokens;
  return reverse;
}

function resolveUserByToken(token: string): string | null {
  const env = getEnv();
  const reverse = getReverseTokenMap(env.syncApiTokens);

  // O(1) candidate lookup, then timing-safe verification
  const candidate = reverse.get(token);
  if (candidate === undefined) {
    return null;
  }
  // Verify with timing-safe comparison to prevent timing attacks
  const expectedToken = env.syncApiTokens.get(candidate);
  if (expectedToken && safeStringEqual(token, expectedToken)) {
    return candidate;
  }
  return null;
}

async function resolveUserByDeviceToken(token: string): Promise<string | null> {
  const result = await findDeviceByToken(token);
  if (!result) return null;
  return result.group.ownerId;
}

export async function authenticateSyncRequest(
  request: Request,
  bodyUserId?: string | null,
): Promise<SyncAuthContext> {
  const env = getEnv();

  if (env.syncAuthMode === "session") {
    throw unauthorized(
      "SYNC_AUTH_MODE=session is not implemented yet on this server",
      "auth_mode_not_implemented",
    );
  }

  const token = getBearerToken(request);
  if (token) {
    // 1. Check env tokens (existing behavior)
    const envUserId = resolveUserByToken(token);
    if (envUserId) {
      if (bodyUserId && bodyUserId !== envUserId) {
        throw forbidden("Body userId does not match token user", "user_mismatch");
      }
      return { userId: envUserId, method: "token" };
    }

    // 2. Fallback: check device tokens from license-store
    // Device tokens prove the device is registered (authentication).
    // Always use the group owner's userId — never trust bodyUserId for device tokens
    // to prevent unauthorized access to other users' data.
    const deviceUserId = await resolveUserByDeviceToken(token);
    if (deviceUserId) {
      if (bodyUserId && bodyUserId !== deviceUserId) {
        throw forbidden("Body userId does not match device owner", "user_mismatch");
      }
      return { userId: deviceUserId, method: "device-token" };
    }

    throw unauthorized("Invalid API token", "invalid_token");
  }

  if (env.syncAllowInsecureDevUserIdFallback && bodyUserId) {
    return { userId: bodyUserId, method: "dev-body-userid" };
  }

  throw unauthorized("Missing Bearer token");
}

