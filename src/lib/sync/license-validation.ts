// src/lib/sync/license-validation.ts

import { badRequest } from "@/lib/http/error";
import type {
  AdminCreateGroupBody,
  AdminCreateLicenseBody,
  AdminUpdateGroupBody,
  AdminUpdateLicenseBody,
  LicensePlan,
  LicenseStatus,
} from "./license-contracts";

const VALID_PLANS: LicensePlan[] = ["free", "starter", "pro", "enterprise"];
const VALID_STATUSES: LicenseStatus[] = ["active", "trial", "expired", "suspended", "revoked"];

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
