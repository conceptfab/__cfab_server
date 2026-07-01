export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { badRequest, forbidden, tooManyRequests } from "@/lib/http/error";
import { validateKeyFormat } from "@/lib/sync/license-keygen";
import {
  findLicenseByKey,
  getLicense,
  getGroupForLicense,
  registerDevice,
} from "@/lib/sync/license-store";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { getClientIp, parseJsonBody } from "@/lib/http/request";
import { buildCorsHeaders } from "@/lib/http/cors";
import { log } from "@/lib/observability/logger";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request);
  const headers = {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    ...buildCorsHeaders(request, "POST, OPTIONS"),
  };

  try {
    // Rate limit: 5 attempts per minute per IP. fail-closed: brute-force
    // protection on license keys takes priority over availability.
    const clientIp = getClientIp(request) ?? "unknown";
    const rl = await checkRateLimit(`license-activate:${clientIp}`, 5, 60_000, {
      failureMode: "fail-closed",
    });
    if (!rl.allowed) {
      throw tooManyRequests(`Rate limit exceeded. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`);
    }

    const { body } = await parseJsonBody(request, 64 * 1024);
    const raw = body as Record<string, unknown>;

    const licenseKey = typeof raw.licenseKey === "string" ? raw.licenseKey.trim() : "";
    const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "";
    const deviceName = typeof raw.deviceName === "string" ? raw.deviceName.trim() : deviceId;

    if (!licenseKey) throw badRequest("licenseKey is required");
    if (!deviceId) throw badRequest("deviceId is required");

    if (!validateKeyFormat(licenseKey)) {
      throw badRequest("Invalid or unknown license key");
    }

    const license = await findLicenseByKey(licenseKey);
    if (!license) {
      throw badRequest("Invalid or unknown license key");
    }

    if (license.status !== "active" && license.status !== "trial") {
      throw forbidden(
        `License is ${license.status}. Cannot activate.`,
        "license_inactive",
      );
    }

    if (license.expiresAt && new Date(license.expiresAt).getTime() < Date.now()) {
      throw forbidden("License has expired", "license_expired");
    }

    const group = await getGroupForLicense(license.id);
    if (!group) {
      throw badRequest("No group associated with this license");
    }

    const device = await registerDevice(
      license.id,
      group.id,
      deviceId,
      deviceName,
    );

    // Re-read license after registerDevice to get updated activeDevices
    const updatedLicense = await getLicense(license.id);

    log("info", "license.activate", {
      requestId,
      licenseId: license.id,
      deviceId,
      plan: license.plan,
    });

    return NextResponse.json(
      {
        ok: true,
        licenseId: license.id,
        plan: license.plan,
        status: license.status,
        groupId: group.id,
        groupName: group.name,
        deviceId: device.deviceId,
        apiToken: device.apiToken,
        maxDevices: license.maxDevices,
        activeDevices: updatedLicense?.activeDevices.length ?? license.activeDevices.length,
        expiresAt: license.expiresAt,
      },
      { headers },
    );
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const code = (error as { code?: string }).code ?? "internal_error";
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { ok: false, code, error: message, requestId },
      { status, headers },
    );
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(request, "POST, OPTIONS"),
  });
}
