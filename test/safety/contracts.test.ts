import { describe, expect, it } from "vitest";

import {
  REMOVAL_DUE_SECONDS,
  reasonsOnTheClock,
  removalDueLabel,
  removalRule,
  removalRuleLine,
  removalStatements,
  entryReportReasonSchema,
  isEntryReportReason,
  profileReportReasonLabels,
  profileReportReasonSchema,
  profileReportReasons,
  reportReasonLabels,
  reportReasonSchema,
  reportReasons,
  STORED_REPORT_REASONS,
  reportSubjectTypeSchema,
  reportSubjectTypes,
  reportSubjectsThatHide,
} from "../../src/modules/safety/contracts";
import { reports } from "../../src/db/schema-core";

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
  });
});

/**
 * A reason table's stored values.
 */
function values(table: readonly { value: string }[]): Set<string> {
  return new Set(table.map((reason) => reason.value));
}

/**
 * R55·214: a profile has its own reasons, three sharing W1's stored values
 * and two its own (owner, 2026-11-13).
 */
describe("the stored reasons are both sheets' values, once each", () => {
  it("lists W1's values and then a profile's own, with no repeats", () => {
    expect(STORED_REPORT_REASONS).toStrictEqual([
      "explicit",
      "intimate",
      "harassment",
      "spam",
      "not_theirs",
      "other",
      "offensive",
      "impersonation",
    ]);
    expect(new Set(STORED_REPORT_REASONS)).toEqual(
      new Set([...values(reportReasons), ...values(profileReportReasons)]),
    );
  });

  it("is what the column takes and what the Desk parses", () => {
    expect(reports.reason.enumValues).toStrictEqual(STORED_REPORT_REASONS);
    expect(reportReasonSchema.options).toStrictEqual(STORED_REPORT_REASONS);
  });

  it("lets W1 file only W1's reasons, and a profile only its own", () => {
    expect(new Set(entryReportReasonSchema.options)).toEqual(
      values(reportReasons),
    );
    expect(new Set(profileReportReasonSchema.options)).toEqual(
      values(profileReportReasons),
    );
    expect(entryReportReasonSchema.safeParse("offensive").success).toBe(false);
    expect(profileReportReasonSchema.safeParse("explicit").success).toBe(false);
    expect(
      profileReportReasonSchema.safeParse(undefined).error?.issues[0]?.message,
    ).toBe("Pick what's wrong with it.");
    expect(
      entryReportReasonSchema.safeParse(undefined).error?.issues[0]?.message,
    ).toBe("Pick what's wrong with it.");
  });

  it("knows which stored reasons are W1's, the ones with a threshold", () => {
    for (const reason of reportReasons) {
      expect(isEntryReportReason(reason.value)).toBe(true);
    }
    expect(isEntryReportReason("offensive")).toBe(false);
    expect(isEntryReportReason("impersonation")).toBe(false);
  });

  it("gives a profile sheet R55·214's sentences", () => {
    expect(Object.keys(profileReportReasonLabels)).toStrictEqual([
      ...values(profileReportReasons),
    ]);
    expect(profileReportReasonLabels).toStrictEqual({
      offensive: "Their name or photo is offensive",
      harassment: "They're harassing someone",
      impersonation: "They're pretending to be someone else",
      spam: "It's an ad, or it's spam",
      other: "Something else",
    });
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
      new Set(STORED_REPORT_REASONS),
    );
  });

  it("uses W1's sentence for a value both sheets share, and a profile's for its own", () => {
    for (const reason of reportReasons) {
      expect(reportReasonLabels[reason.value]).toBe(reason.label);
    }
    expect(reportReasonLabels.offensive).toBe(
      "Their name or photo is offensive",
    );
    expect(reportReasonLabels.impersonation).toBe(
      "They're pretending to be someone else",
    );
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

describe("what a report can hide (design 164)", () => {
  it("is an entry or a photo, read from the hide table", () => {
    expect(reportSubjectsThatHide).toStrictEqual(["entry", "photo"]);
  });
});

describe("the TAKE IT DOWN Act's clock (design 136, D-117)", () => {
  it("runs for an intimate image and no other reason", () => {
    // A statute's line, not a tunable count: how many reporters hide a
    // subject is config (`safety/thresholds`), and failing closed there
    // must never put spam on a 48-hour clock.
    expect(reasonsOnTheClock).toStrictEqual(["intimate"]);
  });

  it("offers a courtesy removal under the rule on photos of other people (D-161)", () => {
    expect(removalStatements.othersPhotos).toBe(
      "it shows someone who didn't agree to it",
    );
    expect(removalRule.othersPhotos).toBe("othersPhotos");
    expect(removalRuleLine("remove", "othersPhotos")).toBe(
      "That breaks our community rules: don't post photos of other people.",
    );
  });

  it("gives the removal the TAKE IT DOWN Act's 48 hours", () => {
    expect(REMOVAL_DUE_SECONDS).toBe(172_800);
  });

  it("tells the moderator and the author the intimate-image reason", () => {
    expect(reportReasonLabels.intimate).toBe(
      "It's an intimate image of someone, shared without their consent",
    );
    expect(removalStatements.intimate).toBe(
      "it's an intimate image shared without consent",
    );
  });
});

describe("the removal clock's words", () => {
  const due = 1_000_000;

  it("rounds the hours left up, so the last minutes still read one hour", () => {
    expect(removalDueLabel(due, due - 1)).toBe("Due in 1h");
    expect(removalDueLabel(due, due - 3600)).toBe("Due in 1h");
    expect(removalDueLabel(due, due - 3601)).toBe("Due in 2h");
    expect(removalDueLabel(due, due - REMOVAL_DUE_SECONDS)).toBe("Due in 48h");
  });

  it("reads Overdue from the moment it is due", () => {
    expect(removalDueLabel(due, due)).toBe("Overdue");
    expect(removalDueLabel(due, due + 1)).toBe("Overdue");
  });
});
