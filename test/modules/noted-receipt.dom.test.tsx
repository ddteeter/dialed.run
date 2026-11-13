import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NotedReceipt,
  notedAnnouncement,
} from "../../src/modules/feed/components/NotedReceipt";
import { drawnText, saidText } from "./spoken-text";

const HOUDINI = {
  shown: "Houdini is now 3 of 5 in 41–50°.",
  said: "Houdini is now 3 of 5 in 41 to 50 degrees.",
};

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
    render(<NotedReceipt sentence={HOUDINI} />);

    // The screen's one region says it (rule 08), through
    // `notedAnnouncement`; a second here announced the save twice.
    expect(screen.queryByRole("status")).toBeNull();
    const receipt = receiptOf();
    expect(drawnText(receipt)).toBe("NotedHoudini is now 3 of 5 in 41–50°.");
    // Round 53 · 162.3: the band is said as a range.
    expect(saidText(receipt)).toBe(
      "NotedHoudini is now 3 of 5 in 41 to 50 degrees.",
    );
  });

  it("draws a sentence with no measure in it once", () => {
    const logged = "Logged. No kit on this run, so no garment record moved.";
    render(<NotedReceipt sentence={{ shown: logged, said: logged }} />);

    expect(screen.getByText(logged).tagName).toBe("P");
    expect(receiptOf()).toHaveTextContent(`Noted${logged}`);
  });

  it("says, for the screen's region, what it shows", () => {
    expect(notedAnnouncement(HOUDINI)).toBe(
      "Noted. Houdini is now 3 of 5 in 41 to 50 degrees.",
    );
    expect(notedAnnouncement(undefined)).toBe("Noted.");
  });

  it("is the teal payoff block, with ink on it", () => {
    // Round 16: "the teal 'noted' block is the payoff". `bg-teal` is the
    // teal T1 keeps for surfaces; `accent-ink` because text on an accent is
    // always ink, inverted block or not.
    render(<NotedReceipt sentence={HOUDINI} />);

    expect(receiptOf()).toHaveClass(
      "bg-teal",
      "text-accent-ink",
      "rounded-card",
    );
  });

  it("holds no button — the tab bar is the exit", () => {
    render(<NotedReceipt sentence={HOUDINI} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names its region the way board A3 does", () => {
    // `data-part="noted"` on the board; the conformance harness diffs the
    // two by that name.
    render(<NotedReceipt sentence={{ shown: "x", said: "x" }} />);

    expect(receiptOf()).toHaveTextContent(/^Noted/);
  });
});
