import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  LEGACY_SYNC_DASHBOARD_AUTH_COOKIE,
  SYNC_DASHBOARD_AUTH_COOKIE,
  getDashboardUserIdFromCookie,
} from "@/lib/auth/dashboard-page-auth";
import { buildAbsoluteRequestUrl } from "@/lib/http/request";
import { getSyncRepository } from "@/lib/sync/repository";

export const runtime = "nodejs";

function redirectTo(request: Request, path: string): NextResponse {
  return NextResponse.redirect(buildAbsoluteRequestUrl(request, path), 303);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const userId = getDashboardUserIdFromCookie(
    cookieStore.get(SYNC_DASHBOARD_AUTH_COOKIE)?.value ??
      cookieStore.get(LEGACY_SYNC_DASHBOARD_AUTH_COOKIE)?.value,
  );

  if (!userId) {
    return redirectTo(request, "/?auth=invalid");
  }

  try {
    await getSyncRepository().resetUserState(userId);
    return redirectTo(request, "/?reset=done");
  } catch {
    return redirectTo(request, "/?reset=error");
  }
}
