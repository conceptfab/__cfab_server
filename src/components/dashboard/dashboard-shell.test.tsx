import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("exposes navigation and marks the current view", () => {
    render(
      <DashboardShell currentView="devices" userId="admin@example.com">
        <p>Treść</p>
      </DashboardShell>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Panel synchronizacji",
    });
    expect(navigation).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Urządzenia" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Treść")).toBeInTheDocument();
  });

  it("keeps logout as a POST form", () => {
    const { container } = render(
      <DashboardShell currentView="overview" userId="admin@example.com">
        <p>Treść</p>
      </DashboardShell>,
    );

    expect(container.querySelector('form[action="/auth/logout"]')).toHaveAttribute(
      "method",
      "post",
    );
  });

  it("provides a mobile navigation disclosure", () => {
    render(
      <DashboardShell currentView="overview" userId="admin@example.com">
        <p>Treść</p>
      </DashboardShell>,
    );

    expect(
      screen.getByText("Menu", { selector: "summary" }),
    ).toBeInTheDocument();
  });
});
