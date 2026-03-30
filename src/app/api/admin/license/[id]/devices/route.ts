export const runtime = "nodejs";

import type { AdminDeviceListResponse } from "@/lib/sync/license-contracts";
import { getDevicesForLicense } from "@/lib/sync/license-store";
import { handleAdminGet, handleAdminOptions } from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminGet(
    request,
    "admin-license-devices",
    async (): Promise<AdminDeviceListResponse> => {
      const devices = await getDevicesForLicense(id);
      return { ok: true, devices, total: devices.length };
    },
  );
}
