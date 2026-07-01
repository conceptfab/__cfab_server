import { describe, it, expect } from "vitest";

import { assertJsonStructure } from "../json-guard";
import { isAppError } from "../error";

const LIMITS = { maxArrayItems: 5, maxObjectKeys: 3, maxDepth: 4 };

function expectRejected(value: unknown): void {
  try {
    assertJsonStructure(value, LIMITS);
    throw new Error("expected assertJsonStructure to throw");
  } catch (err) {
    expect(isAppError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("payload_structure_exceeded");
  }
}

describe("assertJsonStructure", () => {
  it("accepts values within all limits without mutation", () => {
    const value = { a: 1, b: [1, 2, 3], c: { d: [true, null] } };
    const clone = structuredClone(value);
    expect(() => assertJsonStructure(value, LIMITS)).not.toThrow();
    expect(value).toEqual(clone);
  });

  it("accepts scalars", () => {
    expect(() => assertJsonStructure("hello", LIMITS)).not.toThrow();
    expect(() => assertJsonStructure(42, LIMITS)).not.toThrow();
    expect(() => assertJsonStructure(null, LIMITS)).not.toThrow();
  });

  it("accepts exactly at the limits", () => {
    expect(() =>
      assertJsonStructure({ a: [1, 2, 3, 4, 5], b: 1, c: 1 }, LIMITS),
    ).not.toThrow();
  });

  it("rejects arrays over maxArrayItems", () => {
    expectRejected([1, 2, 3, 4, 5, 6]);
  });

  it("rejects objects over maxObjectKeys", () => {
    expectRejected({ a: 1, b: 2, c: 3, d: 4 });
  });

  it("rejects nesting over maxDepth", () => {
    // depth 5 > maxDepth 4
    expectRejected({ a: { b: { c: { d: { e: 1 } } } } });
  });

  it("does not overflow on deeply nested hostile input (iterative walk)", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = { n: deep };
    expectRejected(deep);
  });
});
