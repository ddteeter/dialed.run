import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoverageMark, VerdictMark } from "../../src/ui/Marks";

/**
 * The two encoding channels design round 6 §AB settled.
 *
 * The rule each one exists to keep: **coverage never takes a hue**, and **a
 * verdict is never hue-alone**. Both are assertions about what is *absent*,
 * which is why they are here rather than left to the screens that use them.
 */
/**
 * Which of the three slots is filled. An empty slot keeps `bg-night/15`,
 * so "not the empty class" is what identifies the filled one — reading the
 * position rather than the colour, which is the channel that carries the
 * meaning.
 */
function filledIndex(kind: "cold" | "dialed" | "warm") {
  const { container } = render(<VerdictMark kind={kind} />);
  const slots = [...(container.firstElementChild?.children ?? [])];
  return slots.findIndex((slot) => !slot.className.includes("bg-night/15"));
}

describe("CoverageMark", () => {
  it("draws each level as a different density", () => {
    // Solid, 135° hatch, hairline — one monochrome axis for a quantity
    // that only ever increases, readable in greyscale and without a
    // legend.
    const fills = (["covered", "partial", "unknown"] as const).map((level) => {
      const { container } = render(<CoverageMark level={level} />);
      return container.firstElementChild?.className ?? "";
    });

    expect(fills[0]).toContain("ink-covered");
    expect(fills[1]).toContain("ink-partial");
    expect(fills[2]).toContain("ink-unknown");
    expect(new Set(fills).size).toBe(3);
  });

  it("never takes a hue, on any level", () => {
    // §AB rule 02. Pink, teal and grey mean cold, dialed and warm
    // everywhere and permanently; a coverage swatch borrowing one would
    // teach a second meaning for the same colour.
    for (const level of ["covered", "partial", "unknown"] as const) {
      const { container } = render(<CoverageMark level={level} />);
      expect(container.firstElementChild?.className).not.toMatch(
        /pink|teal|hi-viz/,
      );
    }
  });

  it("says nothing to a screen reader, because its caller already has", () => {
    // "The counts are there so the reading never depends on the swatch" —
    // every caller prints the level beside this, so announcing it here
    // would read the same fact twice.
    const { container } = render(<CoverageMark level="partial" />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("VerdictMark", () => {
  it("fills the slot whose position means the verdict", () => {
    // Cold left, dialed centre, warm right — under-, on-, over-dressed.
    // Position is the channel; hue only repeats it.

    expect(filledIndex("cold")).toBe(0);
    expect(filledIndex("dialed")).toBe(1);
    expect(filledIndex("warm")).toBe(2);
  });

  it("always draws three slots, so the centre is a position and not a count", () => {
    const { container } = render(<VerdictMark kind="warm" />);

    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it("fills exactly one", () => {
    // Two filled slots would be a distribution, which is a different fact
    // from "how you called it".
    const { container } = render(<VerdictMark kind="dialed" />);
    const slots = [...(container.firstElementChild?.children ?? [])];

    expect(
      slots.filter((slot) => !slot.className.includes("bg-night/15")),
    ).toHaveLength(1);
  });

  it("gives warm full-strength ink, never 30% opacity", () => {
    // §AB rule 04: `text-night/30` is retired. The tint it replaced was
    // indistinguishable from its neighbours *and* under-contrast.
    //
    // **Asserted positively as well as negatively.** "Does not contain
    // /30" is satisfied by a warm slot with no ink class at all — an
    // invisible mark passes a test that only says what it is not.
    const { container } = render(<VerdictMark kind="warm" />);
    const slots = [...(container.firstElementChild?.children ?? [])];

    expect(slots[2]?.className).toContain("bg-night/70");
    expect(container.getHTML()).not.toContain("/30");
  });

  it("keeps pink for cold and teal for dialed", () => {
    // Rule 01: no other meaning may claim these three together.
    const { container: cold } = render(<VerdictMark kind="cold" />);
    const { container: dialed } = render(<VerdictMark kind="dialed" />);

    expect(cold.getHTML()).toContain("bg-pink");
    expect(dialed.getHTML()).toContain("bg-teal");
  });
});
