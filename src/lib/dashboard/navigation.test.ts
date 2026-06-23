import { describe, expect, it } from "vitest";

import { parseDashboardView } from "./navigation";

describe("parseDashboardView", () => {
  it.each(["overview", "activity", "devices", "licenses", "groups", "storage"])(
    "accepts %s",
    (view) => expect(parseDashboardView(view)).toBe(view),
  );

  it.each([undefined, null, "", "unknown", ["devices"]])(
    "falls back to overview for %j",
    (view) => expect(parseDashboardView(view)).toBe("overview"),
  );
});
