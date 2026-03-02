import { getEnv } from "@/lib/config/env";
import type {
  JsonValue,
  SyncAckBody,
  SyncPullBody,
  SyncPushBody,
  SyncStatusBody,
} from "@/lib/sync/contracts";
import { invalidArchive, invalidSyncBody } from "@/lib/sync/errors";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  maxLen = 256,
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw invalidSyncBody(`${field} is required`);
  }
  if (normalized.length > maxLen) {
    throw invalidSyncBody(`${field} is too long`);
  }
  return normalized;
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw invalidSyncBody(`${field} must be a non-negative integer`);
  }
  return value;
}

function optionalHash(value: unknown, field = "clientHash"): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    throw invalidSyncBody(`${field} must be a SHA-256 hex string`);
  }
  return normalized.toLowerCase();
}

function requireHash(value: unknown, field: string): string {
  const normalized = optionalHash(value, field);
  if (!normalized) {
    throw invalidSyncBody(`${field} is required`);
  }
  return normalized;
}

function assertJsonValue(
  value: unknown,
  depth: number,
  visitedNodes: { count: number },
): asserts value is JsonValue {
  const env = getEnv();
  if (depth > env.syncMaxJsonDepth) {
    throw invalidArchive(`JSON depth exceeds limit (${env.syncMaxJsonDepth})`);
  }

  visitedNodes.count += 1;
  if (visitedNodes.count > 500_000) {
    throw invalidArchive("JSON structure is too large");
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > env.syncMaxArrayItems) {
      throw invalidArchive(
        `Array length exceeds limit (${value.length} > ${env.syncMaxArrayItems})`,
      );
    }
    for (const item of value) {
      assertJsonValue(item, depth + 1, visitedNodes);
    }
    return;
  }

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > env.syncMaxObjectKeys) {
      throw invalidArchive(
        `Object key count exceeds limit (${keys.length} > ${env.syncMaxObjectKeys})`,
      );
    }
    for (const key of keys) {
      assertJsonValue(value[key], depth + 1, visitedNodes);
    }
    return;
  }

  throw invalidArchive("archive contains unsupported JSON value");
}

function hasExportArchiveShape(value: JsonValue): boolean {
  if (!isObject(value)) return false;

  const topLevelOk =
    typeof value.version === "string" &&
    typeof value.exported_at === "string" &&
    typeof value.machine_id === "string" &&
    typeof value.export_type === "string" &&
    isObject(value.date_range) &&
    isObject(value.metadata) &&
    isObject(value.data);

  if (!topLevelOk) {
    return false;
  }

  const data = value.data;
  if (!isObject(data)) return false;

  return (
    Array.isArray(data.projects) &&
    Array.isArray(data.applications) &&
    Array.isArray(data.sessions) &&
    Array.isArray(data.manual_sessions) &&
    isObject(data.daily_files)
  );
}

function assertBodyObject(body: unknown): asserts body is Record<string, unknown> {
  if (!isObject(body)) {
    throw invalidSyncBody("Invalid request body");
  }
}

export function validateStatusBody(body: unknown): SyncStatusBody {
  assertBodyObject(body);

  return {
    userId: normalizeOptionalString(body.userId),
    deviceId: requireNonEmptyString(body.deviceId, "deviceId"),
    clientRevision: optionalNonNegativeInteger(body.clientRevision, "clientRevision"),
    clientHash: optionalHash(body.clientHash),
  };
}

export function validatePushBody(body: unknown): SyncPushBody {
  assertBodyObject(body);

  const deviceId = requireNonEmptyString(body.deviceId, "deviceId");
  const knownServerRevision = optionalNonNegativeInteger(
    body.knownServerRevision,
    "knownServerRevision",
  );

  if (!("archive" in body)) {
    throw invalidArchive("archive is required");
  }

  const visitedNodes = { count: 0 };
  assertJsonValue(body.archive, 0, visitedNodes);
  const archive = body.archive as JsonValue;

  if (!hasExportArchiveShape(archive)) {
    throw invalidArchive("archive has invalid shape");
  }

  return {
    userId: normalizeOptionalString(body.userId),
    deviceId,
    knownServerRevision,
    archive,
  };
}

export function validatePullBody(body: unknown): SyncPullBody {
  assertBodyObject(body);

  return {
    userId: normalizeOptionalString(body.userId),
    deviceId: requireNonEmptyString(body.deviceId, "deviceId"),
    clientRevision: optionalNonNegativeInteger(body.clientRevision, "clientRevision"),
  };
}

export function validateAckBody(body: unknown): SyncAckBody {
  assertBodyObject(body);
  const revision = optionalNonNegativeInteger(body.revision, "revision");
  if (revision === null) {
    throw invalidSyncBody("revision is required");
  }

  return {
    userId: normalizeOptionalString(body.userId),
    deviceId: requireNonEmptyString(body.deviceId, "deviceId"),
    revision,
    payloadSha256: requireHash(body.payloadSha256, "payloadSha256"),
  };
}
