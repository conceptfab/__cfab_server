import { NextResponse } from "next/server";

import {
  SYNC_DASHBOARD_AUTH_COOKIE,
  clearDashboardAuthCookieValue,
} from "@/lib/auth/dashboard-page-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/?auth=logged_out", request.url));
  const cleared = clearDashboardAuthCookieValue();
  response.cookies.set(SYNC_DASHBOARD_AUTH_COOKIE, cleared.value, cleared.options);
  return response;
}

