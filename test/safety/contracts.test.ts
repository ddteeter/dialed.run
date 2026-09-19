import { describe, expect, it } from "vitest";

import {
  autoHideReporterThreshold,
  reportReasonLabels,
  reportReasonSchema,
  reportReasons,
  reportSubjectTypeSchema,
  reportSubjectTypes,
} from "../../src/modules/safety/contracts";

/**
 * The derived tables, pinned against their source in both directions.
 *
 * CLAUDE.md's rule: "A derived table needs a test that pins it against its
 * source, so the derivation itself can't rot silently." Both directions,
 * because a one-way check passes happily on a superset — which is exactly
 * how a value ends up accepted by the schema and unreachable in the UI.
 */

describe("the reason schema derives from the reason table", () => {
  it("accepts every reason the table offers", () => {
    for (const reason of reportReasons) {
      expect(reportReasonSchema.parse(reason.value)).toBe(reason.value);
    }
  });

  it("accepts nothing the table does not offer", () => {
    // The other direction. A schema that accepted `sexual_content` while
    // the sheet offered `explicit` would store a value no screen can
    // produce and no reviewer would recognise.
    expect(reportReasonSchema.safeParse("sexual_content").success).toBe(false);
    expect(reportReasonSchema.safeParse("").success).toBe(false);
    expect(reportReasonSchema.options).toHaveLength(reportReasons.length);
  });

  it("says something a runner would read when nothing is chosen", () => {
    const result = reportReasonSchema.safeParse(undefined);
    expect(result.success).toBe(false);
    // Not zod's default, which names the stored values back at someone on
    // a sheet whose whole point is that the words are theirs.
    expect(result.error?.issues[0]?.message).toBe("Pick what's wrong with it.");
  });
});

describe("the label lookup derives from the same table", () => {
  it("has a label for every reason and no others", () => {
    // Sets, because the order a table is written in is not a fact about
    // the derivation.
    expect(new Set(Object.keys(reportReasonLabels))).toEqual(
      new Set(reportReasons.map((reason) => reason.value)),
    );
  });

  it("uses the table's own sentences", () => {
    for (const reason of reportReasons) {
      expect(reportReasonLabels[reason.value]).toBe(reason.label);
    }
  });

  it("keeps the artboard's wording rather than policy categories", () => {
    // W1's own note: "Reasons are written as sentences a runner would say,
    // not policy categories." Pinned here as well as in the DOM test,
    // because this is where someone editing the table would be.
    expect(reportReasonLabels.explicit).toBe(
      "The photo shows someone inappropriately",
    );
    expect(reportReasonLabels.not_theirs).toBe(
      "This isn't their run or their gear",
    );
  });
});

describe("the subject-type schema derives from its table", () => {
  it("matches in both directions", () => {
    for (const subjectType of reportSubjectTypes) {
      expect(reportSubjectTypeSchema.parse(subjectType)).toBe(subjectType);
    }
    expect(reportSubjectTypeSchema.options).toHaveLength(
      reportSubjectTypes.length,
    );
  });

  it("includes product, because product names are UGC (D-26)", () => {
    const types: readonly string[] = reportSubjectTypes;
    expect(types).toContain("product");
  });
});

describe("the auto-hide threshold", () => {
  it("is the packet's default of three distinct reporters", () => {
    // Named rather than inlined so the threshold check and the test that
    // proves three distinct reporters trip it cannot disagree.
    expect(autoHideReporterThreshold).toBe(3);
  });

  it("is more than one, or a single reporter could hide anything", () => {
    expect(autoHideReporterThreshold).toBeGreaterThan(1);
  });
});
