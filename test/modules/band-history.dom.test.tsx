import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BandHistory } from "../../src/modules/feed/components/BandHistory";

/**
 * A3's history line (R-97): "Five states. Your history in this band:
 * [38–46°] · 2 cold · 7 dialed · 1 warm".
 *
 * `verdictBandCounts` answers keyed by verdict, −2..+2. The line folds by
 * sign, as the verdict hues do, so these fixtures put counts on both steps
 * of each side — a line that read only −1 or only +1 would pass a fixture
 * that had nothing on the other step.
 */
// Different on every step, so a mutant that reads +2 for −2 (or any
// other swap) changes a number on screen. An earlier fixture had 1 on
// both −2 and +2, and exactly that mutant survived.
const COUNTS = { "-2": 3, "-1": 1, "0": 7, "1": 0, "2": 2 };

/**
 * The measured half by everything it draws. The brackets are their own
 * hidden spans (D-150), so the line's text is split across three nodes and
 * a plain text match would find none of them.
 */
function wholeText(
  text: string | RegExp,
): (content: string, element: Element | null) => boolean {
  return (_content, element) => {
    const drawn = element?.textContent ?? "";
    return (
      element?.tagName === "SPAN" &&
      (typeof text === "string" ? drawn === text : text.test(drawn))
    );
  };
}

describe("BandHistory", () => {
  it("states the band and folds the counts by sign", () => {
    render(
      <BandHistory
        counts={COUNTS}
        bandFloor={5}
        units={{ temp: "f", distance: "mi" }}
      />,
    );

    // 5°C is 41°F; a band is five degrees Celsius wide.
    expect(
      screen.getByText(wholeText("[41–50°] · 4 cold · 7 dialed · 2 warm")),
    ).toBeVisible();
    // The whole sentence, spaces included — a regex on the prose half let
    // the space before the measured half go missing unnoticed.
    expect(screen.getByText(/^Five states\./).closest("p")).toHaveTextContent(
      "Five states. Your history in this band: [41–50°] · 4 cold · 7 dialed · 2 warm",
      { normalizeWhitespace: false },
    );
  });

  it("draws the band's brackets without saying them", () => {
    // D-150: a reader hears "41–50° · 4 cold …", not "left bracket".
    render(
      <BandHistory
        counts={COUNTS}
        bandFloor={5}
        units={{ temp: "f", distance: "mi" }}
      />,
    );

    const glyphs = screen.getAllByText(/^[[\]]$/u);
    expect(glyphs.map((glyph) => glyph.textContent)).toEqual(["[", "]"]);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("writes the band in the runner's own units", () => {
    render(
      <BandHistory
        counts={COUNTS}
        bandFloor={5}
        units={{ temp: "c", distance: "km" }}
      />,
    );

    expect(screen.getByText(wholeText(/^\[5–10°\]/u))).toBeVisible();
  });

  it("sets the measured half in mixed-case mono, because it sits in prose", () => {
    // tokens.js: `xs` and `sm` are uppercase; `md` is mixed case for
    // values inside prose. Uppercase here would shout "7 DIALED" in the
    // middle of a sentence.
    render(
      <BandHistory
        counts={COUNTS}
        bandFloor={5}
        units={{ temp: "f", distance: "mi" }}
      />,
    );

    const measured = screen.getByText(
      wholeText("[41–50°] · 4 cold · 7 dialed · 2 warm"),
    );
    expect(measured).toHaveClass("font-mono", "text-mono-md");
    expect(measured).not.toHaveClass("uppercase");
  });

  it("says there is no history, in the words DS2 already uses for it", () => {
    // Design gave DS2's rail "No runs in this band yet." for the same fact;
    // A3's board draws no zero state of its own.
    const { container } = render(
      <BandHistory
        counts={{ "-2": 0, "-1": 0, "0": 0, "1": 0, "2": 0 }}
        bandFloor={5}
        units={{ temp: "f", distance: "mi" }}
      />,
    );

    expect(container).toHaveTextContent(
      "Five states. No runs in this band yet.",
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("treats history as history whatever the three counts balance to", () => {
    // "No history" is all three at zero, not any sum that happens to come
    // to zero. These two fixtures are chosen so the wrong operator would
    // land exactly on zero: cold + dialed equal to warm, and cold + warm
    // equal to dialed.
    for (const counts of [
      { "-1": 1, "0": 0, "1": 1 },
      { "-1": 1, "0": 2, "1": 1 },
    ]) {
      const { container, unmount } = render(
        <BandHistory
          counts={counts}
          bandFloor={5}
          units={{ temp: "f", distance: "mi" }}
        />,
      );
      expect(container).toHaveTextContent(/Your history in this band/);
      unmount();
    }
  });

  it("counts a verdict missing from the answer as none of it", () => {
    // A sparse answer must read as zeros, not as NaN on the screen.
    render(
      <BandHistory
        counts={{ "0": 3 }}
        bandFloor={5}
        units={{ temp: "f", distance: "mi" }}
      />,
    );

    expect(
      screen.getByText(wholeText("[41–50°] · 0 cold · 3 dialed · 0 warm")),
    ).toBeVisible();
  });
});
