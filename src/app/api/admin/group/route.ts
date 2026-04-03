export const runtime = "nodejs";

import type {
  AdminGroupListResponse,
  AdminGroupResponse,
} from "@/lib/sync/license-contracts";
import { createGroup, getAllGroups } from "@/lib/sync/license-store";
import { validateCreateGroupBody } from "@/lib/sync/license-validation";
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
    "admin-group-create",
    validateCreateGroupBody,
    async (body): Promise<AdminGroupResponse> => {
      const group = await createGroup(
        body.name,
        body.ownerId,
        body.licenseId,
        body.storageBackendId,
        body.fixedMasterDeviceId,
        body.maxSyncFrequencyHours,
        body.maxDatabaseSizeMb,
      );
      return { ok: true, group };
    },
  );
}

export async function GET(request: Request) {
  return handleAdminGet(
    request,
    "admin-group-list",
    async (): Promise<AdminGroupListResponse> => {
      const groups = await getAllGroups();
      return { ok: true, groups, total: groups.length };
    },
  );
}
