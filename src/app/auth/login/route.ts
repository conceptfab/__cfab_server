import { NextResponse } from "next/server";

import {
  SYNC_DASHBOARD_AUTH_COOKIE,
  buildDashboardAuthCookieValue,
  getDashboardAuthCookieOptions,
  validateDashboardCredentials,
} from "@/lib/auth/dashboard-page-auth";

export const runtime = "nodejs";

function redirectTo(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const userId = String(formData.get("userId") ?? "");
  const token = String(formData.get("token") ?? "");

  const validation = validateDashboardCredentials(userId, token);
  if (!validation.ok) {
    return redirectTo(request, "/?auth=invalid");
  }

  const response = redirectTo(request, "/");
  response.cookies.set(
    SYNC_DASHBOARD_AUTH_COOKIE,
    buildDashboardAuthCookieValue(validation.userId, token),
    getDashboardAuthCookieOptions(),
  );
  return response;
}

