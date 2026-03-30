export const runtime = "nodejs";

import { badRequest } from "@/lib/http/error";
import type {
  AdminDeleteResponse,
  AdminLicenseResponse,
} from "@/lib/sync/license-contracts";
import {
  deleteLicense,
  getLicense,
  updateLicense,
} from "@/lib/sync/license-store";
import { validateUpdateLicenseBody } from "@/lib/sync/license-validation";
import {
  handleAdminDelete,
  handleAdminGet,
  handleAdminOptions,
  handleAdminPatch,
} from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminGet(
    request,
    "admin-license-detail",
    async (): Promise<AdminLicenseResponse> => {
      const license = await getLicense(id);
      if (!license) throw badRequest(`License not found: ${id}`);
      return { ok: true, license };
    },
  );
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminPatch(
    request,
    "admin-license-update",
    validateUpdateLicenseBody,
    async (body): Promise<AdminLicenseResponse> => {
      const license = await updateLicense(id, body);
      if (!license) throw badRequest(`License not found: ${id}`);
      return { ok: true, license };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminDelete(
    request,
    "admin-license-delete",
    async (): Promise<AdminDeleteResponse> => {
      const deleted = await deleteLicense(id);
      return { ok: true, deleted };
    },
  );
}
