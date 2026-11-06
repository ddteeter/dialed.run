import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NotedReceipt,
  notedAnnouncement,
} from "../../src/modules/feed/components/NotedReceipt";

function receiptOf(): Element {
  const receipt = document.querySelector("[data-slot='noted']");
  if (receipt === null) throw new Error("no receipt");
  return receipt;
}

/**
 * A3's Noted block (design round 20): a receipt in the submit's place,
 * with no button in it.
 */
describe("NotedReceipt", () => {
  it("shows the sentence, and is no status region of its own", () => {
    render(<NotedReceipt sentence="Houdini is now 3 of 5 in 41–50°." />);

    // The screen's one region says it (rule 08), through
    // `notedAnnouncement`; a second here announced the save twice.
    expect(screen.queryByRole("status")).toBeNull();
    const receipt = receiptOf();
    expect(receipt).toHaveTextContent("Houdini is now 3 of 5 in 41–50°.");
    expect(receipt).toHaveTextContent(/^Noted/);
  });

  it("says, for the screen's region, what it shows", () => {
    expect(notedAnnouncement("Houdini is now 3 of 5 in 41–50°.")).toBe(
      "Noted. Houdini is now 3 of 5 in 41–50°.",
    );
    expect(notedAnnouncement(undefined)).toBe("Noted.");
  });

  it("is the teal payoff block, with ink on it", () => {
    // Round 16: "the teal 'noted' block is the payoff". `bg-teal` is the
    // teal T1 keeps for surfaces; `accent-ink` because text on an accent is
    // always ink, inverted block or not.
    render(<NotedReceipt sentence="Houdini is now 3 of 5 in 41–50°." />);

    expect(receiptOf()).toHaveClass(
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

    expect(receiptOf()).toHaveTextContent(/^Noted/);
  });
});
