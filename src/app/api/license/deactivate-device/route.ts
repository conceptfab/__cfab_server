export const runtime = "nodejs";

import { handleSyncPost, handleSyncOptions } from "@/lib/sync/http";
import { badRequest } from "@/lib/http/error";
import {
  getAllGroups,
  getAllLicenses,
  deregisterDevice,
} from "@/lib/sync/license-store";

interface DeactivateBody {
  deviceId: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<DeactivateBody, { ok: true; deactivated: boolean }>(request, {
    route: "session-status",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      return { deviceId: body.deviceId.trim() };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: async ({ userId, body }) => {
      const groups = await getAllGroups();
      const group = groups.find((g) => g.ownerId === userId);
      if (!group) throw badRequest("No group found for this user");

      const licenses = await getAllLicenses();
      const license = licenses.find((l) => l.id === group.licenseId);
      if (!license) throw badRequest("No license found");

      const deactivated = await deregisterDevice(license.id, body.deviceId);
      return { ok: true as const, deactivated };
    },
  });
}
