import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CoverageBand } from "../../src/modules/feed";
import { CallLadder } from "../../src/modules/onboarding/components/CallLadder";
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

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // The gap is the point of the screen — it has to be visible to be
    // asked for.
    expect(rows[1]).toHaveTextContent("[5–10°]");
    expect(rows[1]).toHaveTextContent("[unknown]");
  });

  it("labels coverage as text, not as a colour alone", () => {
    // design-deltas item 6: pink/teal/grey already mean cold/dialed/warm
    // on the profile. Until that is resolved, coverage is words.
    render(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 1 }),
          band(10),
        ])}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    // Lower case on purpose, and this is the assertion for it: `Mono`
    // applies the uppercase in CSS so the *accessible name* stays in
    // normal case — several screen readers spell a short all-caps token
    // out letter by letter. Typing "COVERED" here would pass while
    // shipping a worse announcement.
    expect(rows[0]).toHaveTextContent("[covered]");
    expect(rows[1]).toHaveTextContent("[partial]");
    expect(rows[2]).toHaveTextContent("[unknown]");
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

    expect(screen.getByRole("listitem")).toHaveTextContent("7");
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
