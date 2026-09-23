import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotedReceipt } from "../../src/modules/feed/components/NotedReceipt";

/**
 * A3's Noted block (design round 20): a receipt in the submit's place,
 * with no button in it.
 */
describe("NotedReceipt", () => {
  it("announces the sentence when it lands", () => {
    render(<NotedReceipt sentence="Houdini is now 3 of 5 in 41–50°." />);

    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent("Houdini is now 3 of 5 in 41–50°.");
    expect(receipt).toHaveTextContent(/^Noted/);
  });

  it("is the teal payoff block, with ink on it", () => {
    // Round 16: "the teal 'noted' block is the payoff". `bg-teal` is the
    // teal T1 keeps for surfaces; `accent-ink` because text on an accent is
    // always ink, inverted block or not.
    render(<NotedReceipt sentence="Houdini is now 3 of 5 in 41–50°." />);

    expect(screen.getByRole("status")).toHaveClass(
      "bg-teal",
      "text-accent-ink",
      "rounded-card",
    );
  });

  it("holds no button — the tab bar is the exit", () => {
    render(<NotedReceipt sentence="Houdini is now 3 of 5 in 41–50°." />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names its region the way board A3 does", () => {
    // `data-part="noted"` on the board; the conformance harness diffs the
    // two by that name.
    render(<NotedReceipt sentence="x" />);

    expect(screen.getByRole("status")).toHaveAttribute("data-slot", "noted");
  });
});
