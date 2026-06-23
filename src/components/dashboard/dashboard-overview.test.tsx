import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardOverview } from "./dashboard-overview";

describe("DashboardOverview", () => {
  it("prioritizes an offline storage alert", () => {
    render(
      <DashboardOverview
        model={{
          systemStatus: "degraded",
          uptimeSeconds: 192,
          storage: {
            available: false,
            lastCheckAt: "2026-06-23T12:00:00.000Z",
            error: "ECONNREFUSED",
          },
          counts: {
            devices: 0,
            licenses: 0,
            groups: 0,
            storageBackends: 0,
          },
          recentActivity: [],
          setup: { completed: 1, total: 4 },
          alert: {
            title: "Storage jest niedostępny",
            description: "ECONNREFUSED",
            targetView: "storage",
          },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Storage jest niedostępny",
    );
    expect(
      screen.getByRole("link", { name: "Otwórz ustawienia storage" }),
    ).toHaveAttribute("href", "/?view=storage");
    expect(
      screen.getByText("Brak aktywności synchronizacji"),
    ).toBeInTheDocument();
  });

  it("renders recent sync activity when it exists", () => {
    render(
      <DashboardOverview
        model={{
          systemStatus: "operational",
          uptimeSeconds: 3600,
          storage: {
            available: true,
            lastCheckAt: "2026-06-23T12:00:00.000Z",
            error: null,
          },
          counts: {
            devices: 1,
            licenses: 1,
            groups: 1,
            storageBackends: 1,
          },
          recentActivity: [
            {
              id: "entry-1",
              timestamp: "2026-06-23T12:00:00.000Z",
              action: "push",
              status: "ok",
              userId: "admin",
              deviceId: "device-123456789",
              revision: 4,
              hash: "abc",
              sizeBytes: 1024,
              durationMs: 120,
              detail: "Uploaded",
            },
          ],
          setup: { completed: 4, total: 4 },
          alert: null,
        }}
      />,
    );

    expect(screen.getByText("PUSH")).toBeInTheDocument();
    expect(screen.getByText("device-1234")).toBeInTheDocument();
    expect(screen.getByText("1h 0m 0s")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
