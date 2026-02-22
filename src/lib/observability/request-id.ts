import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

export function getOrCreateRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming) {
    return incoming;
  }
  return randomUUID();
}

