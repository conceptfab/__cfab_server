import { NextResponse } from "next/server";

import {
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  SYNC_DASHBOARD_AUTH_COOKIE,
  buildDashboardSessionCookieValue,
  getDashboardAuthCookieOptions,
  validateDashboardCredentials,
} from "@/lib/auth/dashboard-page-auth";
import { buildAbsoluteRequestUrl } from "@/lib/http/request";

export const runtime = "nodejs";

function redirectTo(request: Request, path: string): NextResponse {
  return NextResponse.redirect(buildAbsoluteRequestUrl(request, path), 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const userId = String(formData.get("i") ?? formData.get("userId") ?? "");
  const token = String(formData.get("k") ?? formData.get("token") ?? "");

  const validation = validateDashboardCredentials(userId, token);
  if (!validation.ok) {
    return redirectTo(request, "/?auth=invalid");
  }

  const response = redirectTo(request, "/");
  response.cookies.set(
    SYNC_DASHBOARD_AUTH_COOKIE,
    buildDashboardSessionCookieValue(validation.userId),
    getDashboardAuthCookieOptions(),
  );
  response.cookies.set(
    LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
    "",
    { ...getDashboardAuthCookieOptions(), maxAge: 0 },
  );
  return response;
}
