import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardCommandMenu } from "./dashboard-command-menu";

describe("DashboardCommandMenu", () => {
  it("opens with Ctrl+K, filters views and closes with Escape", () => {
    render(<DashboardCommandMenu />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      screen.getByRole("dialog", { name: "Przejdź do widoku" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "stor" },
    });
    expect(screen.getByRole("link", { name: "Storage" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Urządzenia" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
