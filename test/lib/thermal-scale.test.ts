import { describe, expect, it } from "vitest";

import {
  THERMAL_LEVEL_C,
  thermalLevelSchema,
  thermalOffset,
  thermalScale,
} from "../../src/lib/contracts";

/**
 * The five answers to O1, pinned against the schema that stores them.
 *
 * The mapping used to be a comment, and a comment cannot fail.
 */
describe("thermalScale", () => {
  it("offers a value the schema accepts for every answer", () => {
    for (const { value } of thermalScale) {
      expect(thermalLevelSchema.safeParse(value).success).toBe(true);
    }
  });

  it("covers the schema's whole range, with no gaps and no repeats", () => {
    // −2..+2 is five integers; anything else means an answer was added
    // without widening the schema, or the schema widened without an answer.
    expect(new Set(thermalScale.map((entry) => entry.value))).toStrictEqual(
      new Set([-2, -1, 0, 1, 2]),
    );
  });

  it("reads cold-first, because positive means runs cold", () => {
    // The direction people get backwards. "Always freezing" is +2: someone
    // who needs *more* than the table says.
    expect(thermalScale[0]).toMatchObject({ value: 2, label: "Always freezing" });
    expect(thermalScale.at(-1)).toMatchObject({ value: -2 });
  });

  it("descends, so the list renders in the order the design shows", () => {
    // The exact sequence, not "is sorted": O1 shows coldest-first, and a
    // list that happened to be sorted the other way would still be sorted.
    expect(thermalScale.map((entry) => entry.value)).toStrictEqual([
      2, 1, 0, -1, -2,
    ]);
  });

  it("gives every answer its own token and its own words", () => {
    expect(new Set(thermalScale.map((e) => e.token)).size).toBe(thermalScale.length);
    expect(new Set(thermalScale.map((e) => e.label)).size).toBe(thermalScale.length);
  });
});

/**
 * The offset O1 shows beside each answer — the other half of the mapping
 * that used to be a comment.
 */
describe("thermalOffset", () => {
  it("matches the artboard, in Fahrenheit", () => {
    // O1 draws +8°, +4°, 0°, −4°, −8°. Those are the numbers a runner sees,
    // so they are what this pins — not the °C the app stores.
    expect(thermalScale.map((entry) => thermalOffset(entry.value, "f")))
      .toStrictEqual([8, 4, 0, -4, -8]);
  });

  it("converts a difference, never an absolute temperature", () => {
    // The bug this function exists to prevent: `c * 1.8 + 32` turns +8 into
    // +40, and +40 on a screen about how warm someone runs is wrong in a
    // way nobody would notice. Zero is the tell — a delta of 0°C is 0°F,
    // and an absolute conversion makes it 32.
    expect(thermalOffset(0, "f")).toBe(0);
  });

  it("gives Celsius the step it is defined in", () => {
    expect(thermalOffset(2, "c")).toBe(Math.round(2 * THERMAL_LEVEL_C));
    expect(thermalOffset(-2, "c")).toBe(-Math.round(2 * THERMAL_LEVEL_C));
  });

  it("is symmetric, because the scale is", () => {
    for (const { value } of thermalScale) {
      expect(thermalOffset(value, "f")).toBe(-thermalOffset(-value, "f"));
    }
  });
});
