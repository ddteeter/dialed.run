import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunRemovals } from "../../src/modules/safety/components/RunRemovals";

/**
R-140: the band on the author's run, one per removal, newest first.
*/
const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("RunRemovals", () => {
  it("draws a band for each removal, in the order given", () => {
    render(
      <RunRemovals
        removals={[
          {
            id: "01JREMOVAL0000000000000002",
            subjectType: "entry",
            action: "remove",
            reason: "spam",
          },
          {
            id: "01JREMOVAL0000000000000001",
            subjectType: "photo",
            action: "takedown",
            reason: "copyright",
          },
        ]}
      />,
    );

    const bands = part("run-removals")?.querySelectorAll(
      "[data-part='notice-band']",
    );
    expect([...(bands ?? [])].map((band) => band.textContent)).toStrictEqual([
      "Removed from the feedA moderator removed this entry from the feed: it's an ad or spam.",
      "Photo removedWe removed this photo after a copyright notice.Your run and verdict stay.",
    ]);
  });

  it("renders nothing for a run nothing was taken off", () => {
    render(<RunRemovals removals={[]} />);
    expect(part("run-removals")).toBeNull();
  });
});
