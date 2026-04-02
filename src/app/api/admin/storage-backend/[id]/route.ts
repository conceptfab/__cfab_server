export const runtime = "nodejs";

import { badRequest } from "@/lib/http/error";
import type {
  AdminDeleteResponse,
  AdminStorageBackendResponse,
  AdminStorageBackendTestResponse,
} from "@/lib/sync/license-contracts";
import {
  deleteStorageBackend,
  getStorageBackend,
  updateStorageBackend,
} from "@/lib/sync/license-store";
import { validateUpdateStorageBackendBody } from "@/lib/sync/license-validation";
import {
  handleAdminDelete,
  handleAdminGet,
  handleAdminOptions,
  handleAdminPatch,
  handleAdminPost,
} from "@/lib/sync/admin-http";
import { createStorageAdapter } from "@/lib/sync/sftp-manager";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminGet(
    request,
    "admin-storage-backend-get",
    async (): Promise<AdminStorageBackendResponse> => {
      const storageBackend = await getStorageBackend(id);
      if (!storageBackend) throw badRequest(`Storage backend not found: ${id}`);
      return { ok: true, storageBackend };
    },
  );
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminPatch(
    request,
    "admin-storage-backend-update",
    validateUpdateStorageBackendBody,
    async (body): Promise<AdminStorageBackendResponse> => {
      const storageBackend = await updateStorageBackend(id, body);
      if (!storageBackend) throw badRequest(`Storage backend not found: ${id}`);
      return { ok: true, storageBackend };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminDelete(
    request,
    "admin-storage-backend-delete",
    async (): Promise<AdminDeleteResponse> => {
      const result = await deleteStorageBackend(id);
      if (!result.deleted && result.reason) {
        throw badRequest(result.reason);
      }
      return { ok: true, deleted: result.deleted };
    },
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  // POST to /admin/storage-backend/{id} = test connection
  return handleAdminPost(
    request,
    "admin-storage-backend-test",
    (body) => body, // no body needed
    async (): Promise<AdminStorageBackendTestResponse> => {
      const backend = await getStorageBackend(id);
      if (!backend) throw badRequest(`Storage backend not found: ${id}`);

      try {
        const adapter = createStorageAdapter(backend);
        await adapter.healthCheck();
        return { ok: true, reachable: true, error: null };
      } catch (error) {
        return {
          ok: true,
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
