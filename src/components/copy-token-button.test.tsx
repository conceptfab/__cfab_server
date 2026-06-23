import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyTokenButton } from "./copy-token-button";

describe("CopyTokenButton", () => {
  it("announces a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyTokenButton token="abcdefgh-secret" />);

    fireEvent.click(screen.getByRole("button", { name: "Skopiuj token abcdefgh" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Skopiowano"));
    expect(writeText).toHaveBeenCalledWith("abcdefgh-secret");
  });
});
