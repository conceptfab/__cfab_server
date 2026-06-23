import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DashboardDrawer } from "./dashboard-drawer";

describe("DashboardDrawer", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });

  it("opens from the trigger and returns focus after Escape", () => {
    render(
      <DashboardDrawer title="Nowa licencja" triggerLabel="Nowa licencja">
        <p>Formularz</p>
      </DashboardDrawer>,
    );

    const trigger = screen.getByRole("button", { name: "Nowa licencja" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Nowa licencja" });
    expect(dialog).toHaveAttribute("open");

    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });
});
