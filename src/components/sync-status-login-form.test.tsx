import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncStatusLoginForm } from "./sync-status-login-form";

describe("SyncStatusLoginForm", () => {
  it("exposes invalid credentials as an alert", () => {
    render(<SyncStatusLoginForm authState="invalid" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nieprawidłowy identyfikator lub token");
  });

  it("toggles token visibility", () => {
    render(<SyncStatusLoginForm authState={null} />);
    const token = screen.getByLabelText("Token administratora");
    expect(token).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Pokaż token" }));
    expect(token).toHaveAttribute("type", "text");
  });
});
