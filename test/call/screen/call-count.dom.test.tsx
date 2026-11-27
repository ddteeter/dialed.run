import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CallCount } from "../../../src/modules/call/screen/components/CallCount";
import { belowThresholdCall, drawnFrom } from "./fixtures";

/**
 * C0b's count toward the first Call, with Round 62's 362: the reading of
 * what is counted, and the line for verdicts that do not count.
 */
const NONE_COUNTED =
  "Verdicts count on runs with conditions. Yours so far have none.";

function countHeader(verdictsSoFar: number) {
  const { header } = drawnFrom(belowThresholdCall(verdictsSoFar)).view;
  if (header.kind !== "count") throw new Error("not a count");
  return header;
}

function count(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-part="count"]');
  if (element === null) throw new Error("no count");
  return element;
}

describe("the count below the threshold", () => {
  it("says how many verdicts remain, under the header's own words", () => {
    render(<CallCount header={countHeader(8)} />);

    expect(count().textContent).toBe(
      "UNTIL YOUR FIRST CALL7 more verdicts8 of 15 verdicts counted",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "7 more verdicts",
    );
  });

  it("uses the header's noun, so one remaining is one verdict", () => {
    render(<CallCount header={countHeader(14)} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "1 more verdict",
    );
    expect(screen.getByText("14 of 15 verdicts counted")).toBeInTheDocument();
  });

  it("reads 0 of 15 counted with none, and says nothing more to a runner with no verdict", () => {
    render(<CallCount header={countHeader(0)} />);

    expect(screen.getByText("0 of 15 verdicts counted")).toBeInTheDocument();
    expect(screen.queryByText(NONE_COUNTED)).toBeNull();
  });

  it("says why none counts to a runner whose verdicts are all on runs without conditions", () => {
    render(<CallCount header={countHeader(0)} verdictsLogged={1} />);

    expect(count().textContent).toBe(
      `UNTIL YOUR FIRST CALL15 more verdicts0 of 15 verdicts counted${NONE_COUNTED}`,
    );
    expect(screen.getByText(NONE_COUNTED).tagName).toBe("P");
  });

  it("does not say it once a verdict counts, whatever else was logged", () => {
    render(<CallCount header={countHeader(3)} verdictsLogged={9} />);

    expect(screen.queryByText(NONE_COUNTED)).toBeNull();
  });
});
