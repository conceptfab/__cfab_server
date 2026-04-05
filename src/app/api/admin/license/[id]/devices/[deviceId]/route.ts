export const runtime = "nodejs";

import type { AdminDeleteResponse } from "@/lib/sync/license-contracts";
import { deregisterDevice, regenerateDeviceToken } from "@/lib/sync/license-store";
import { handleAdminDelete, handleAdminOptions, handleAdminPost } from "@/lib/sync/admin-http";
import { badRequest } from "@/lib/http/error";

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

export async function POST(request: Request, { params }: RouteParams) {
  const { id, deviceId } = await params;
  return handleAdminPost(
    request,
    "admin-device-regenerate-token",
    () => ({}),
    async () => {
      const device = await regenerateDeviceToken(id, deviceId);
      if (!device) {
        throw badRequest("Device not found or does not belong to this license");
      }
      return { ok: true, device };
    },
  );
}
