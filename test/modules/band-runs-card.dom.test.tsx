import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BandRunsCard } from "../../src/modules/feed/components/BandRunsCard";

/**
 * The band history card's heading (round 25), drawn as a range and said
 * in words (round 53 #162.3).
 */
describe("BandRunsCard", () => {
  it("says a band below freezing as the lead's words go on", () => {
    // A said line starts with a capital; inside "In …" it must not, or
    // "In Minus 10" is read as a name.
    render(
      <BandRunsCard
        lead={() => "In"}
        bandFloor={-10}
        precipMm={0}
        runs={[]}
        units={{ temp: "c", distance: "km" }}
      />,
    );

    const heading = screen.getByRole("heading", {
      name: "In minus 10 to minus 5 degrees, dry",
    });
    expect(heading).toHaveTextContent(/^In -10–-5° dry/u);
  });
});
