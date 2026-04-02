// src/lib/sync/license-validation.ts

import { badRequest } from "@/lib/http/error";
import type {
  AdminCreateGroupBody,
  AdminCreateLicenseBody,
  AdminCreateStorageBackendBody,
  AdminUpdateGroupBody,
  AdminUpdateLicenseBody,
  AdminUpdateStorageBackendBody,
  LicensePlan,
  LicenseStatus,
  StorageBackendType,
} from "./license-contracts";

const VALID_PLANS: LicensePlan[] = ["free", "starter", "pro", "enterprise"];
const VALID_STATUSES: LicenseStatus[] = ["active", "trial", "expired", "suspended", "revoked"];
const VALID_BACKEND_TYPES: StorageBackendType[] = ["sftp", "aws-s3"];

function assertObject(body: unknown): asserts body is Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest("Expected string value");
  return value.trim() || undefined;
}

function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw badRequest(`${field} must be a positive integer`);
  }
  return value;
}

function optionalNullableNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a number or null`);
  }
  return value;
}

export function validateCreateLicenseBody(body: unknown): AdminCreateLicenseBody {
  assertObject(body);
  const plan = requireString(body.plan, "plan");
  if (!VALID_PLANS.includes(plan as LicensePlan)) {
    throw badRequest(`plan must be one of: ${VALID_PLANS.join(", ")}`);
  }
  return {
    plan: plan as LicensePlan,
    groupId: optionalString(body.groupId),
    groupName: optionalString(body.groupName),
    ownerId: optionalString(body.ownerId),
    maxDevices: optionalPositiveInt(body.maxDevices, "maxDevices"),
    expiresAt: body.expiresAt === null ? null : optionalString(body.expiresAt),
  };
}

export function validateUpdateLicenseBody(body: unknown): AdminUpdateLicenseBody {
  assertObject(body);
  const result: AdminUpdateLicenseBody = {};

  if (body.plan !== undefined) {
    const plan = requireString(body.plan, "plan");
    if (!VALID_PLANS.includes(plan as LicensePlan)) {
      throw badRequest(`plan must be one of: ${VALID_PLANS.join(", ")}`);
    }
    result.plan = plan as LicensePlan;
  }

  if (body.status !== undefined) {
    const status = requireString(body.status, "status");
    if (!VALID_STATUSES.includes(status as LicenseStatus)) {
      throw badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    result.status = status as LicenseStatus;
  }

  result.maxDevices = optionalPositiveInt(body.maxDevices, "maxDevices");
  if (body.expiresAt !== undefined) {
    result.expiresAt = body.expiresAt === null ? null : optionalString(body.expiresAt) ?? undefined;
  }

  return result;
}

export function validateCreateGroupBody(body: unknown): AdminCreateGroupBody {
  assertObject(body);
  return {
    name: requireString(body.name, "name"),
    ownerId: requireString(body.ownerId, "ownerId"),
    licenseId: requireString(body.licenseId, "licenseId"),
    storageBackendId: optionalString(body.storageBackendId),
    fixedMasterDeviceId: body.fixedMasterDeviceId === null ? null : optionalString(body.fixedMasterDeviceId),
    maxSyncFrequencyHours: optionalNullableNumber(body.maxSyncFrequencyHours, "maxSyncFrequencyHours"),
    maxDatabaseSizeMb: optionalNullableNumber(body.maxDatabaseSizeMb, "maxDatabaseSizeMb"),
  };
}

export function validateUpdateGroupBody(body: unknown): AdminUpdateGroupBody {
  assertObject(body);
  return {
    name: optionalString(body.name),
    fixedMasterDeviceId: body.fixedMasterDeviceId === null ? null : optionalString(body.fixedMasterDeviceId),
    maxSyncFrequencyHours: optionalNullableNumber(body.maxSyncFrequencyHours, "maxSyncFrequencyHours"),
    maxDatabaseSizeMb: optionalNullableNumber(body.maxDatabaseSizeMb, "maxDatabaseSizeMb"),
  };
}

// ---------------------------------------------------------------------------
// Storage backend validation
// ---------------------------------------------------------------------------

export function validateCreateStorageBackendBody(body: unknown): AdminCreateStorageBackendBody {
  assertObject(body);
  const type = requireString(body.type, "type");
  if (!VALID_BACKEND_TYPES.includes(type as StorageBackendType)) {
    throw badRequest(`type must be one of: ${VALID_BACKEND_TYPES.join(", ")}`);
  }

  const base: AdminCreateStorageBackendBody = {
    type: type as StorageBackendType,
    name: requireString(body.name, "name"),
    basePath: requireString(body.basePath, "basePath"),
    maxFileSizeMb: optionalPositiveInt(body.maxFileSizeMb, "maxFileSizeMb"),
    sessionTtlMinutes: optionalPositiveInt(body.sessionTtlMinutes, "sessionTtlMinutes"),
  };

  if (type === "sftp") {
    base.host = requireString(body.host, "host");
    base.port = optionalPositiveInt(body.port, "port");
    base.username = requireString(body.username, "username");
    base.password = requireString(body.password, "password");
  } else if (type === "aws-s3") {
    base.region = requireString(body.region, "region");
    base.bucket = requireString(body.bucket, "bucket");
    base.accessKeyId = requireString(body.accessKeyId, "accessKeyId");
    base.secretAccessKey = requireString(body.secretAccessKey, "secretAccessKey");
    base.usePresignedUrls = typeof body.usePresignedUrls === "boolean" ? body.usePresignedUrls : false;
  }

  return base;
}

export function validateUpdateStorageBackendBody(body: unknown): AdminUpdateStorageBackendBody {
  assertObject(body);
  return {
    name: optionalString(body.name),
    basePath: optionalString(body.basePath),
    maxFileSizeMb: optionalPositiveInt(body.maxFileSizeMb, "maxFileSizeMb"),
    sessionTtlMinutes: optionalPositiveInt(body.sessionTtlMinutes, "sessionTtlMinutes"),
    host: optionalString(body.host),
    port: optionalPositiveInt(body.port, "port"),
    username: optionalString(body.username),
    password: optionalString(body.password),
    region: optionalString(body.region),
    bucket: optionalString(body.bucket),
    accessKeyId: optionalString(body.accessKeyId),
    secretAccessKey: optionalString(body.secretAccessKey),
    usePresignedUrls: typeof body.usePresignedUrls === "boolean" ? body.usePresignedUrls : undefined,
  };
}
