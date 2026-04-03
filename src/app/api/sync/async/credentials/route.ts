export const runtime = "nodejs";

import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleAsyncCredentials, type AsyncCredentialsResponse } from "@/lib/sync/async-delta";
import { badRequest } from "@/lib/http/error";

interface CredentialsBody {
  deviceId: string;
  packageId: string;
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost<CredentialsBody, AsyncCredentialsResponse>(request, {
    route: "async-pending",
    parseBody: (raw: unknown) => {
      const body = raw as Record<string, unknown>;
      if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
        throw badRequest("deviceId is required");
      }
      if (typeof body.packageId !== "string" || !body.packageId.trim()) {
        throw badRequest("packageId is required");
      }
      return {
        deviceId: body.deviceId,
        packageId: body.packageId,
      };
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleAsyncCredentials(userId, body.deviceId, body.packageId),
  });
}
