export const runtime = "nodejs";

import type {
  AdminStorageBackendListResponse,
  AdminStorageBackendResponse,
  SftpStorageBackend,
  S3StorageBackend,
} from "@/lib/sync/license-contracts";
import { createStorageBackend, getAllStorageBackends } from "@/lib/sync/license-store";
import { validateCreateStorageBackendBody } from "@/lib/sync/license-validation";
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
    "admin-storage-backend-create",
    validateCreateStorageBackendBody,
    async (body): Promise<AdminStorageBackendResponse> => {
      let config: Omit<SftpStorageBackend, "id" | "createdAt"> | Omit<S3StorageBackend, "id" | "createdAt">;

      if (body.type === "sftp") {
        config = {
          type: "sftp",
          name: body.name,
          basePath: body.basePath,
          maxFileSizeMb: body.maxFileSizeMb ?? 100,
          sessionTtlMinutes: body.sessionTtlMinutes ?? 60,
          host: body.host!,
          port: body.port ?? 22,
          username: body.username!,
          password: body.password!,
        };
      } else {
        config = {
          type: "aws-s3",
          name: body.name,
          basePath: body.basePath,
          maxFileSizeMb: body.maxFileSizeMb ?? 100,
          sessionTtlMinutes: body.sessionTtlMinutes ?? 60,
          region: body.region!,
          bucket: body.bucket!,
          accessKeyId: body.accessKeyId!,
          secretAccessKey: body.secretAccessKey!,
          usePresignedUrls: body.usePresignedUrls ?? false,
        };
      }

      const storageBackend = await createStorageBackend(config);
      return { ok: true, storageBackend };
    },
  );
}

export async function GET(request: Request) {
  return handleAdminGet(
    request,
    "admin-storage-backend-list",
    async (): Promise<AdminStorageBackendListResponse> => {
      const storageBackends = await getAllStorageBackends();
      return { ok: true, storageBackends, total: storageBackends.length };
    },
  );
}
