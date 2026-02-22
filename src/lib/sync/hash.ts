import { createHash } from "node:crypto";

import type { JsonValue } from "@/lib/sync/contracts";

export function sha256Json(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function jsonByteSize(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

