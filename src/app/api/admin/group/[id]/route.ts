export const runtime = "nodejs";

import { badRequest } from "@/lib/http/error";
import type { AdminGroupResponse } from "@/lib/sync/license-contracts";
import { updateGroup } from "@/lib/sync/license-store";
import { validateUpdateGroupBody } from "@/lib/sync/license-validation";
import { handleAdminOptions, handleAdminPatch } from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminPatch(
    request,
    "admin-group-update",
    validateUpdateGroupBody,
    async (body): Promise<AdminGroupResponse> => {
      const group = await updateGroup(id, body);
      if (!group) throw badRequest(`Group not found: ${id}`);
      return { ok: true, group };
    },
  );
}
