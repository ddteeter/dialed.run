import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SheetReceipt } from "../../src/ui";

function renderReceipt() {
  const onDone = vi.fn();
  render(
    <SheetReceipt
      part="some-receipt"
      kicker="Thing sent"
      heading="Thanks."
      onDone={onDone}
    >
      <p>What happens next.</p>
    </SheetReceipt>,
  );
  return onDone;
}

describe("SheetReceipt", () => {
  it("says what was sent, then the heading, then what happens next, then Done", () => {
    renderReceipt();
    const receipt = document.querySelector("[data-part='some-receipt']");
    expect(receipt).toHaveTextContent(
      "Thing sentThanks.What happens next.Done",
    );
    expect(screen.getByText("Thing sent")).toHaveClass("text-muted");
  });

  it("puts focus on its heading, so the swap is read out", () => {
    renderReceipt();
    const heading = screen.getByRole("heading", { level: 2, name: "Thanks." });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("closes on Done, a chalk pill", async () => {
    const user = userEvent.setup();
    const onDone = renderReceipt();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveAttribute("type", "button");
    await user.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
