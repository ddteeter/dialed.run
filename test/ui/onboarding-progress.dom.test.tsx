import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OnboardingProgress } from "../../src/ui/OnboardingProgress";
import type { OnboardingStep } from "../../src/ui/OnboardingProgress";

/**
 * Round 47 #120: three steps, the handle then two optional ones, and P2.5
 * keeps the tap list's kicker with the bar full.
 */
function progress(at: OnboardingStep) {
  const { container } = render(<OnboardingProgress at={at} />);
  const segments = [
    ...container.querySelectorAll<HTMLElement>(
      ":scope [aria-hidden='true'] > span",
    ),
  ];
  return {
    segments,
    done: segments.filter((segment) => segment.dataset.state === "done"),
  };
}

describe("OnboardingProgress", () => {
  it.each([
    ["handle", "Step 1 of 3", 1],
    ["city", "Step 2 of 3 · Optional", 2],
    ["tapList", "Step 3 of 3 · Optional", 3],
  ] as const)("at %s says %s and fills %i of three", (at, kicker, filled) => {
    const { segments, done } = progress(at);

    expect(screen.getByText(kicker)).toBeVisible();
    expect(segments).toHaveLength(3);
    expect(done).toHaveLength(filled);
    // The filled ones are the first ones: the bar fills from the left.
    expect(segments.slice(0, filled)).toEqual(done);
  });

  it("draws the bar in ink and hairline rules, and does not say it", () => {
    const { segments } = progress("city");

    expect(segments[0]?.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(segments[1]).toHaveClass("border-t-2", "border-ink");
    expect(segments[2]).toHaveClass("border-t-2", "border-hairline");
    expect(segments[2]).not.toHaveClass("border-ink");
  });

  it("sets the kicker in mono capitals by CSS, so it is read as words", () => {
    progress("handle");

    const kicker = screen.getByText("Step 1 of 3");
    expect(kicker).toHaveClass("font-mono", "uppercase", "text-muted");
  });
});
