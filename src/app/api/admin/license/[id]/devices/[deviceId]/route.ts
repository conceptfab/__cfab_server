export const runtime = "nodejs";

import type { AdminDeleteResponse } from "@/lib/sync/license-contracts";
import { deregisterDevice } from "@/lib/sync/license-store";
import { handleAdminDelete, handleAdminOptions } from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string; deviceId: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id, deviceId } = await params;
  return handleAdminDelete(
    request,
    "admin-device-deregister",
    async (): Promise<AdminDeleteResponse> => {
      const deleted = await deregisterDevice(id, deviceId);
      return { ok: true, deleted };
    },
  );
}
