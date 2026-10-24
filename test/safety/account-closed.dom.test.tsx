import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountClosed } from "../../src/modules/safety/components/AccountClosed";

/**
 * Operator Screens D4 as design-deltas item 23 redrew it: a notice band on
 * Au1 (round 27, "Au1 account closed Google"). Its promises are copy, so
 * the copy is what is asserted — the board's words, nothing to press, no
 * date and no reason.
 */
describe("D4 · the notice, on Au1 (item 23)", () => {
  it("says the board's three lines word for word, then the owner's fallback", () => {
    render(<AccountClosed />);
    const band = document.querySelector("[data-part='account-closed']");
    expect(band?.textContent).toBe(
      [
        "Account closed",
        "This account was closed for breaking the community rules.",
        "Think we got it wrong? Reply to the email we sent you.",
        "Or write to desk@dialed.run.",
      ].join(""),
    );
  });

  it("is a notice band, with both appeal lines quiet", () => {
    render(<AccountClosed />);
    const notice = document.querySelector(
      "[data-part='account-closed'] [data-part='notice-band']",
    );
    expect(notice).not.toBeNull();
    expect(
      screen.getByText(
        "Think we got it wrong? Reply to the email we sent you.",
      ),
    ).toHaveClass("text-quiet");
    const appeal = screen.getByRole("link").parentElement;
    expect(appeal).toHaveTextContent(/^Or write to desk@dialed\.run\.$/u);
    expect(appeal).toHaveClass("text-quiet");
  });

  it("links the appeal address to an email to it (round 38 #62a)", () => {
    render(<AccountClosed />);
    const link = screen.getByRole("link", { name: "desk@dialed.run" });
    expect(link).toHaveAttribute("href", "mailto:desk@dialed.run");
  });

  it("offers nothing to press but the address, and promises no time to an answer (D-73)", () => {
    const { container } = render(<AccountClosed />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/within|week|\bdays?\b/u);
  });
});
