export const runtime = "nodejs";

import type {
  AdminLicenseListResponse,
  AdminLicenseResponse,
} from "@/lib/sync/license-contracts";
import { createGroup } from "@/lib/sync/license-store";
import { createLicense, getAllLicenses } from "@/lib/sync/license-store";
import { validateCreateLicenseBody } from "@/lib/sync/license-validation";
import {
  handleAdminGet,
  handleAdminOptions,
  handleAdminPost,
} from "@/lib/sync/admin-http";

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function POST(request: Request) {
  return handleAdminPost(
    request,
    "admin-license-create",
    validateCreateLicenseBody,
    async (body): Promise<AdminLicenseResponse> => {
      let groupId = body.groupId;

      if (!groupId && body.groupName) {
        const group = await createGroup(
          body.groupName,
          body.ownerId ?? "admin",
          "",
        );
        groupId = group.id;
      }

      if (!groupId) {
        const group = await createGroup(
          "Default",
          body.ownerId ?? "admin",
          "",
        );
        groupId = group.id;
      }

      const license = await createLicense(
        body.plan,
        groupId,
        body.maxDevices,
        body.expiresAt,
      );

      return { ok: true, license };
    },
  );
}

export async function GET(request: Request) {
  return handleAdminGet(
    request,
    "admin-license-list",
    async (): Promise<AdminLicenseListResponse> => {
      const licenses = await getAllLicenses();
      return { ok: true, licenses, total: licenses.length };
    },
  );
}
