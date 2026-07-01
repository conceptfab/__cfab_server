import { describe, it, expect } from "vitest";

import { assertDeviceIdBinding, type SyncAuthContext } from "../server-auth";
import { isAppError } from "@/lib/http/error";

function ctx(overrides: Partial<SyncAuthContext>): SyncAuthContext {
  return {
    userId: "user-1",
    method: "device-token",
    tokenDeviceId: "device-A",
    ...overrides,
  };
}

describe("assertDeviceIdBinding", () => {
  it("passes when device-token deviceId matches body deviceId", () => {
    expect(() => assertDeviceIdBinding(ctx({}), "device-A")).not.toThrow();
  });

  it("rejects when body deviceId differs from token deviceId", () => {
    try {
      assertDeviceIdBinding(ctx({}), "device-B");
      throw new Error("expected throw");
    } catch (err) {
      expect(isAppError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("device_id_mismatch");
    }
  });

  it("rejects when body deviceId is missing for a device token", () => {
    expect(() => assertDeviceIdBinding(ctx({}), null)).toThrow();
    expect(() => assertDeviceIdBinding(ctx({}), undefined)).toThrow();
  });

  it("is transparent for env-token (tokenDeviceId null) regardless of body", () => {
    const envCtx = ctx({ method: "token", tokenDeviceId: null });
    expect(() => assertDeviceIdBinding(envCtx, "anything")).not.toThrow();
    expect(() => assertDeviceIdBinding(envCtx, null)).not.toThrow();
  });

  it("is transparent for dev-body-userid fallback", () => {
    const devCtx = ctx({ method: "dev-body-userid", tokenDeviceId: null });
    expect(() => assertDeviceIdBinding(devCtx, "whatever")).not.toThrow();
  });
});
