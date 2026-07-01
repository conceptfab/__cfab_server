import { describe, it, expect } from "vitest";

import {
  deriveGroupKeyV2,
  deriveGroupKey,
  isE2eKeyScheme,
} from "../storage-encryption";

describe("deriveGroupKeyV2 (#1 E2E v2)", () => {
  it("is deterministic for the same passphrase + groupId", () => {
    const a = deriveGroupKeyV2("correct horse battery staple", "group-1");
    const b = deriveGroupKeyV2("correct horse battery staple", "group-1");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // 32 bytes hex
  });

  it("differs for a different passphrase (server can't derive without it)", () => {
    const a = deriveGroupKeyV2("passphrase-A", "group-1");
    const b = deriveGroupKeyV2("passphrase-B", "group-1");
    expect(a).not.toBe(b);
  });

  it("differs for a different groupId (salt/context separation)", () => {
    const a = deriveGroupKeyV2("same-pass", "group-1");
    const b = deriveGroupKeyV2("same-pass", "group-2");
    expect(a).not.toBe(b);
  });

  it("is domain-separated from the v1 groupId-only key", () => {
    // v1 uses groupId as the whole material; v2 uses a passphrase equal to groupId
    // must NOT collide thanks to the -v2 domain separator + scrypt.
    expect(deriveGroupKeyV2("group-1", "group-1")).not.toBe(deriveGroupKey("group-1"));
  });

  it("rejects empty passphrase or groupId", () => {
    expect(() => deriveGroupKeyV2("", "group-1")).toThrow();
    expect(() => deriveGroupKeyV2("pass", "  ")).toThrow();
  });

  it("validates key scheme values", () => {
    expect(isE2eKeyScheme("v1-groupid")).toBe(true);
    expect(isE2eKeyScheme("v2-passphrase")).toBe(true);
    expect(isE2eKeyScheme("v3-nope")).toBe(false);
    expect(isE2eKeyScheme(undefined)).toBe(false);
  });
});
