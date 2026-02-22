import { NextResponse } from "next/server";

import {
  SYNC_DASHBOARD_AUTH_COOKIE,
  clearDashboardAuthCookieValue,
} from "@/lib/auth/dashboard-page-auth";
import { buildAbsoluteRequestUrl } from "@/lib/http/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(
    buildAbsoluteRequestUrl(request, "/?auth=logged_out"),
    303,
  );
  const cleared = clearDashboardAuthCookieValue();
  response.cookies.set(SYNC_DASHBOARD_AUTH_COOKIE, cleared.value, cleared.options);
  return response;
}
