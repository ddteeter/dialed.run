import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Sheet, SheetReceipt } from "../../src/ui";

function renderReceipt() {
  const onDone = vi.fn();
  render(
    <Sheet open onClose={vi.fn()} kicker="Thing sent" label="Thanks.">
      <SheetReceipt part="some-receipt" onDone={onDone}>
        <p>What happens next.</p>
      </SheetReceipt>
    </Sheet>,
  );
  return onDone;
}

describe("SheetReceipt", () => {
  it("says what happens next, then Done", () => {
    renderReceipt();
    const receipt = document.querySelector("[data-part='some-receipt']");
    expect(receipt).toHaveTextContent(/^What happens next\.Done$/);
  });

  it("puts focus on the sheet's heading, so the swap is read out", async () => {
    renderReceipt();
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Thanks.",
      hidden: true,
    });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it("focuses nothing outside a sheet", () => {
    // A receipt is only ever a sheet's; outside one it has no heading to
    // send focus to, and it must not throw looking.
    render(
      <SheetReceipt part="loose" onDone={vi.fn()}>
        <p>Next.</p>
      </SheetReceipt>,
    );
    expect(document.body).toHaveFocus();
  });

  it("closes on Done", async () => {
    const user = userEvent.setup();
    const onDone = renderReceipt();
    const done = screen.getByRole("button", { name: "Done", hidden: true });
    expect(done).toHaveAttribute("type", "button");
    await user.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
