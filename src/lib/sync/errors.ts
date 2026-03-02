import { badRequest } from "@/lib/http/error";

export function invalidSyncBody(message: string) {
  return badRequest(message, "invalid_sync_body");
}

export function invalidArchive(message: string) {
  return badRequest(message, "invalid_archive");
}

