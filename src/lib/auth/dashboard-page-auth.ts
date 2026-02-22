import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";

export const SYNC_DASHBOARD_AUTH_COOKIE = "cfab_sync_dashboard_auth";
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

interface DashboardAuthCookiePayload {
  userId: string;
  token: string;
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

function encodePayload(payload: DashboardAuthCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
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
    maxAge: SEVEN_DAYS_SECONDS,
  };
}

export function buildDashboardAuthCookieValue(userId: string, token: string): string {
  return encodePayload({
    userId: userId.trim(),
    token: normalizeTokenInput(token) ?? token.trim(),
  });
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
  const payload = decodePayload(rawCookieValue);
  if (!payload) return null;

  const validation = validateDashboardCredentials(payload.userId, payload.token);
  return validation.ok ? validation.userId : null;
}
