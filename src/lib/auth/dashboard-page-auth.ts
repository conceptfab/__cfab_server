import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";

export const SYNC_DASHBOARD_AUTH_COOKIE = "timeflow_sync_dashboard_auth";
export const LEGACY_SYNC_DASHBOARD_AUTH_COOKIE = "cfab_sync_dashboard_auth";
/** #7: short-lived dashboard session (was 7 days storing the raw API token). */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface DashboardAuthCookiePayload {
  userId: string;
  token: string;
}

interface DashboardSessionPayload {
  userId: string;
  exp: number; // epoch ms
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTokenInput(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) return null;

  let token = normalized;
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }

  return token.length > 0 ? token : null;
}

function decodePayload(rawCookieValue: string): DashboardAuthCookiePayload | null {
  try {
    const json = Buffer.from(rawCookieValue, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const userId = normalizeNonEmptyString((parsed as { userId?: unknown }).userId);
    const token = normalizeNonEmptyString((parsed as { token?: unknown }).token);
    if (!userId || !token) {
      return null;
    }

    return { userId, token };
  } catch {
    return null;
  }
}

export function getDashboardAuthCookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// #7: signed short-lived session cookie (no raw API token stored client-side).
// Format: `<base64url(payload)>.<base64url(hmac)>`. Legacy v1 cookies (a single
// base64url blob with {userId, token}, no dot) are still accepted until they
// expire, but new logins never mint them.
// ---------------------------------------------------------------------------

function getSessionSigningKey(): string | null {
  const env = getEnv();
  return env.dashboardSessionSecret ?? env.adminApiToken ?? env.syncApiTokenSecret;
}

function sign(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

function verifySignature(payloadB64: string, signatureB64: string, key: string): boolean {
  const expected = sign(payloadB64, key);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureB64, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Builds a signed, short-lived session cookie value for the given user. */
export function buildDashboardSessionCookieValue(userId: string): string {
  const key = getSessionSigningKey();
  if (!key) {
    throw new Error(
      "Dashboard session signing key missing (set DASHBOARD_SESSION_SECRET or ADMIN_API_TOKEN)",
    );
  }
  const payload: DashboardSessionPayload = {
    userId: userId.trim(),
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, key)}`;
}

function verifySignedSession(rawCookieValue: string): string | null {
  const dot = rawCookieValue.indexOf(".");
  if (dot < 0) return null; // not a signed-session cookie (maybe legacy v1)
  const key = getSessionSigningKey();
  if (!key) return null;

  const payloadB64 = rawCookieValue.slice(0, dot);
  const signatureB64 = rawCookieValue.slice(dot + 1);
  if (!verifySignature(payloadB64, signatureB64, key)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const userId = normalizeNonEmptyString((parsed as { userId?: unknown }).userId);
    const exp = (parsed as { exp?: unknown }).exp;
    if (!userId || typeof exp !== "number" || Date.now() >= exp) return null;
    return userId;
  } catch {
    return null;
  }
}

export function clearDashboardAuthCookieValue() {
  return {
    value: "",
    options: {
      ...getDashboardAuthCookieOptions(),
      maxAge: 0,
    },
  };
}

export function validateDashboardCredentials(
  userIdInput: string,
  tokenInput: string,
): { ok: true; userId: string } | { ok: false } {
  const userId = userIdInput.trim();
  const token = normalizeTokenInput(tokenInput) ?? "";
  if (!userId || !token) {
    return { ok: false };
  }

  const env = getEnv();
  const expectedToken = env.syncApiTokens.get(userId);
  if (!expectedToken) {
    return { ok: false };
  }

  if (!safeStringEqual(token, expectedToken)) {
    return { ok: false };
  }

  return { ok: true, userId };
}

export function getDashboardUserIdFromCookie(rawCookieValue: string | undefined): string | null {
  if (!rawCookieValue) return null;

  // Preferred: signed short-lived session (#7).
  const signedUserId = verifySignedSession(rawCookieValue);
  if (signedUserId) return signedUserId;

  // Legacy v1 fallback: base64url({userId, token}) validated against env token.
  // Accepted only until existing cookies expire; new logins mint signed sessions.
  const payload = decodePayload(rawCookieValue);
  if (!payload) return null;

  const validation = validateDashboardCredentials(payload.userId, payload.token);
  return validation.ok ? validation.userId : null;
}

