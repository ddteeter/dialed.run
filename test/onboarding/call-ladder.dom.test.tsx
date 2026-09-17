import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CoverageBand } from "../../src/modules/feed";
import {
  CallLadder,
  ThinnestAsk,
} from "../../src/modules/onboarding/components/CallLadder";
import { ladderFrom } from "../../src/modules/onboarding/ladder";

/**
 * The Call tab's teaser (D-16, O6).
 *
 * The assertion that matters most is the one about what is *absent*: this
 * screen shows progress and never a recommendation, because the call is
 * the next epic and a teaser that guessed an outfit would ship the thing
 * the data is not good enough for yet.
 */
function band(bandFloorC: number, counts: Partial<CoverageBand> = {}): CoverageBand {
  return {
    bandFloorC,
    label: `${String(bandFloorC)}–${String(bandFloorC + 5)}°`,
    cold: 0,
    dialed: 0,
    warm: 0,
    ...counts,
  };
}

/**
The band rows, not the legend's — both are lists of `<li>`.
*/
function bandRows() {
  const [bands] = screen.getAllByRole("list");
  return within(bands ?? document.body).getAllByRole("listitem");
}

describe("CallLadder", () => {
  it("tells a runner with nothing logged that it is listening", () => {
    render(<CallLadder ladder={ladderFrom([])} />);

    expect(
      screen.getByText(/Logging now, calling later/),
    ).toBeVisible();
    // No ladder at all rather than an empty frame: there is nothing to
    // show, and a row of zeroes would read as a failure to load.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("counts down to the first call", () => {
    render(<CallLadder ladder={ladderFrom([band(0, { dialed: 4 })])} />);

    expect(screen.getByText(/verdicts until your first call/)).toBeVisible();
    expect(screen.getByText("11")).toBeVisible();
  });

  it("names the thinnest band, which is the ask", () => {
    render(
      <CallLadder
        ladder={ladderFrom([band(-5), band(0, { dialed: 4 })])}
      />,
    );

    // The words as well as the band: without them the line is a bracket
    // floating under a countdown with nothing saying what it is.
    // The whole sentence including the space, which is a deliberate
    // `{" "}`: JSX drops whitespace between elements, so without it this
    // reads "Thinnest so far:[-5–0°]". Asserting the two halves separately
    // passes either way, which is how the missing space would ship.
    expect(screen.getByText(/Thinnest so far/)).toHaveTextContent(
      "Thinnest so far: [-5–0°]",
    );
  });

  it("says the data is ready and the feature is not, once the threshold is met", () => {
    render(<CallLadder ladder={ladderFrom([band(0, { dialed: 15 })])} />);

    expect(
      screen.getByText(/The call is coming in an update/),
    ).toBeVisible();
    // And stops counting down.
    expect(screen.queryByText(/verdicts until/)).toBeNull();
  });

  it("renders every band it was given, gaps included", () => {
    render(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5),
          band(10, { cold: 1 }),
        ])}
      />,
    );

    const rows = bandRows();
    expect(rows).toHaveLength(3);
    // The gap is the point of the screen — it has to be visible to be
    // asked for.
    expect(rows[1]).toHaveTextContent("[5–10°]");
    // Coverage lost its brackets with the §AB redraw — bracket notation is
    // for measured values, and "unknown" is a level rather than a
    // measurement. The band label keeps them.
    expect(rows[1]).toHaveTextContent("unknown");
  });

  it("labels coverage as text, never as a mark alone", () => {
    // Design round 6 §AB gave coverage ink density, and the words stay:
    // "the counts are there so the reading never depends on the swatch".
    render(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 1 }),
          band(10),
        ])}
      />,
    );

    const rows = bandRows();
    // Lower case on purpose, and this is the assertion for it: `Mono`
    // applies the uppercase in CSS so the *accessible name* stays in
    // normal case — several screen readers spell a short all-caps token
    // out letter by letter. Typing "COVERED" here would pass while
    // shipping a worse announcement.
    expect(rows[0]).toHaveTextContent("covered");
    expect(rows[1]).toHaveTextContent("partial");
    expect(rows[2]).toHaveTextContent("unknown");
  });

  it("marks coverage in ink density, and never in a hue", () => {
    // §AB rule 02: coverage is monochrome, on every surface. Hue means
    // verdict — pink cold, teal dialed, grey warm — and a swatch that
    // borrowed one would be teaching a second meaning for the same colour
    // on the one screen that shows both ideas.
    render(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 1 }),
          band(10),
        ])}
      />,
    );

    // Typed, because `querySelectorAll` answers with `Element` and only an
    // `HTMLElement` carries `dataset`.
    const marks = [
      ...document.querySelectorAll<HTMLElement>("[data-coverage]"),
    ];
    expect(marks.map((mark) => mark.dataset.coverage)).toEqual([
      // Three bands, then the legend's own three.
      "covered",
      "partial",
      "unknown",
      "covered",
      "partial",
      "unknown",
    ]);
    for (const mark of marks) {
      expect(mark.className).not.toMatch(/pink|teal/);
    }
  });

  it("counts the bands at each level, so a hollow year reads as hollow", () => {
    // "Forty verdicts all at 50° leaves January hollow, and a hollow bar
    // looks hollow." The legend is what makes that a number rather than a
    // texture to decode.
    render(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 3 }),
          band(10, { dialed: 1 }),
          band(15),
        ])}
      />,
    );

    const legend = screen.getAllByRole("list")[1];
    expect(legend).toBeDefined();
    expect(within(legend ?? document.body).getByText(/covered 2/)).toBeVisible();
    expect(within(legend ?? document.body).getByText(/partial 1/)).toBeVisible();
    expect(within(legend ?? document.body).getByText(/unknown 1/)).toBeVisible();
  });

  it("shows how many verdicts each band holds, adding all three kinds", () => {
    // All three counts non-zero and distinct, so a sum that subtracted one
    // of them would show a different number. With 2/4/1 a `cold - dialed +
    // warm` reads -1, where 2/0/1 would still read 3 and pass.
    render(
      <CallLadder
        ladder={ladderFrom([band(0, { cold: 2, dialed: 4, warm: 1 })])}
      />,
    );

    const [row] = bandRows();
    expect(row).toHaveTextContent("7");
  });

  it("never recommends a garment", () => {
    // The hard line in the packet. If this screen ever grows a kit, it has
    // stopped being a teaser.
    render(
      <CallLadder ladder={ladderFrom([band(0, { dialed: 20 })])} />,
    );

    expect(screen.queryByText(/wear|jacket|tights|singlet/i)).toBeNull();
  });
});

/**
 * The ask, on its own, because inside the ladder its empty case cannot
 * happen — a runner with verdicts always has a thinnest band. Lifting it
 * out is what turned an equivalent mutant into a tested one.
 */
describe("ThinnestAsk", () => {
  it("names the band worth logging next", () => {
    render(<ThinnestAsk band={band(-5, { dialed: 1 })} />);

    expect(screen.getByText(/Thinnest so far/)).toHaveTextContent(
      "Thinnest so far: [-5–0°]",
    );
  });

  it("renders nothing when there is no band to ask for", () => {
    // Not an empty paragraph: a blank line under the headline would read
    // as something that failed to load.
    const { container } = render(<ThinnestAsk band={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
