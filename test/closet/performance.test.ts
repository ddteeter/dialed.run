import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildCoOccurrence,
  classifyPerformance,
  summarizeByItem,
  topPairIds,
  type EntryItemRow,
  type PerformanceSummary,
} from "../../src/modules/closet/service";

/**
 * The D-27 performance buckets and the aggregation behind them.
 *
 * Sixty-odd mutants lived in here and every one of them was reachable only
 * through `computeUserPerformance`, which needs a user with a logging
 * history — so the existing tests exercised the happy shape and none of the
 * thresholds. A bucket is a filter a runner picks from a menu; getting one
 * wrong shows them the wrong half of their closet, quietly.
 */

const DAY = 86_400;
const NOW = 1_768_500_000;

function summary(
  overrides: Partial<PerformanceSummary> = {},
): PerformanceSummary {
  return {
    verdictCount: 0,
    dialedCount: 0,
    lastWornAt: undefined,
    mileageM: 0,
    ...overrides,
  };
}

describe("classifyPerformance: untested", () => {
  it("calls an item with no verdicts untested", () => {
    expect(classifyPerformance(summary(), NOW)).toContain("untested");
  });

  it("stops calling it untested after a single verdict", () => {
    // Worn once and rated is not the same as never rated, even though one
    // verdict says almost nothing.
    expect(
      classifyPerformance(summary({ verdictCount: 1 }), NOW),
    ).not.toContain("untested");
  });
});

describe("classifyPerformance: most dialed", () => {
  it("needs three verdicts, not two", () => {
    // Two-for-two is a coincidence. The floor is what stops a single good
    // run promoting a garment to the top of the list.
    expect(
      classifyPerformance(summary({ verdictCount: 2, dialedCount: 2 }), NOW),
    ).not.toContain("most_dialed");
    expect(
      classifyPerformance(summary({ verdictCount: 3, dialedCount: 3 }), NOW),
    ).toContain("most_dialed");
  });

  it("needs 60% dialed, and takes exactly 60%", () => {
    expect(
      classifyPerformance(summary({ verdictCount: 5, dialedCount: 3 }), NOW),
    ).toContain("most_dialed");
    expect(
      classifyPerformance(summary({ verdictCount: 5, dialedCount: 2 }), NOW),
    ).not.toContain("most_dialed");
  });
});

describe("classifyPerformance: never worked", () => {
  it("needs two verdicts and none of them dialed", () => {
    expect(
      classifyPerformance(summary({ verdictCount: 1, dialedCount: 0 }), NOW),
    ).not.toContain("never_worked");
    expect(
      classifyPerformance(summary({ verdictCount: 2, dialedCount: 0 }), NOW),
    ).toContain("never_worked");
  });

  it("does not apply once anything worked", () => {
    expect(
      classifyPerformance(summary({ verdictCount: 5, dialedCount: 1 }), NOW),
    ).not.toContain("never_worked");
  });
});

describe("classifyPerformance: retire candidate", () => {
  it("says nothing about an item that was never worn", () => {
    // No `lastWornAt` is "we have no idea", not "ninety days ago". A brand
    // new garment must not arrive already suggested for retirement.
    expect(classifyPerformance(summary(), NOW)).not.toContain(
      "retire_candidate",
    );
  });

  it("waits past a hundred and eighty days, not up to them", () => {
    expect(
      classifyPerformance(summary({ lastWornAt: NOW - 180 * DAY }), NOW),
    ).not.toContain("retire_candidate");
    expect(
      classifyPerformance(summary({ lastWornAt: NOW - 181 * DAY }), NOW),
    ).toContain("retire_candidate");
  });
});

describe("classifyPerformance: buckets are not exclusive", () => {
  it("can be both never-worked and a retire candidate", () => {
    const buckets = classifyPerformance(
      summary({ verdictCount: 2, dialedCount: 0, lastWornAt: NOW - 400 * DAY }),
      NOW,
    );
    expect(buckets).toStrictEqual(["never_worked", "retire_candidate"]);
  });
});

/**
An entry nobody rated: the column is nullable and null is the value here.
*/
function unrated(): number | null {
  return z.null().parse(JSON.parse("null"));
}

function row(overrides: Partial<EntryItemRow> = {}): EntryItemRow {
  return {
    entryId: "entry-1",
    itemId: "item-1",
    createdAt: NOW,
    verdict: 0,
    distanceM: 5000,
    ...overrides,
  };
}

describe("summarizeByItem", () => {
  it("counts only rated runs as verdicts, and dialed as verdict zero", () => {
    // An unrated entry still happened — it counts towards mileage and
    // last-worn, and must not count towards the verdict ratio.
    const { summaries } = summarizeByItem([
      row({ entryId: "a", verdict: 0 }),
      row({ entryId: "b", verdict: 2 }),
      row({ entryId: "c", verdict: unrated() }),
    ]);

    expect(summaries.get("item-1")).toStrictEqual({
      verdictCount: 2,
      dialedCount: 1,
      lastWornAt: NOW,
      mileageM: 15_000,
    });
  });

  it("keeps the most recent wear, whatever order the rows arrive in", () => {
    const { summaries } = summarizeByItem([
      row({ entryId: "a", createdAt: NOW }),
      row({ entryId: "b", createdAt: NOW - DAY }),
    ]);
    expect(summaries.get("item-1")?.lastWornAt).toBe(NOW);
  });

  it("keeps each item's totals apart", () => {
    const { summaries } = summarizeByItem([
      row({ itemId: "shirt", distanceM: 1000 }),
      row({ itemId: "shorts", distanceM: 2000 }),
    ]);
    expect(summaries.get("shirt")?.mileageM).toBe(1000);
    expect(summaries.get("shorts")?.mileageM).toBe(2000);
  });

  it("groups the items worn together in each entry", () => {
    const { entryItems } = summarizeByItem([
      row({ entryId: "run-1", itemId: "shirt" }),
      row({ entryId: "run-1", itemId: "shorts" }),
      row({ entryId: "run-2", itemId: "shirt" }),
    ]);
    expect(entryItems.get("run-1")).toStrictEqual(["shirt", "shorts"]);
    expect(entryItems.get("run-2")).toStrictEqual(["shirt"]);
  });
});

describe("co-occurrence", () => {
  it("counts a pair once per entry, in both directions", () => {
    const counts = buildCoOccurrence(
      new Map([["run-1", ["shirt", "shorts"]]]),
    );
    expect(counts.get("shirt")?.get("shorts")).toBe(1);
    expect(counts.get("shorts")?.get("shirt")).toBe(1);
  });

  it("never pairs an item with itself", () => {
    const counts = buildCoOccurrence(new Map([["run-1", ["shirt", "shirt"]]]));
    expect(counts.get("shirt")?.get("shirt")).toBeUndefined();
  });

  it("accumulates across entries", () => {
    const counts = buildCoOccurrence(
      new Map([
        ["run-1", ["shirt", "shorts"]],
        ["run-2", ["shirt", "shorts"]],
        ["run-3", ["shirt", "cap"]],
      ]),
    );
    expect(counts.get("shirt")?.get("shorts")).toBe(2);
    expect(counts.get("shirt")?.get("cap")).toBe(1);
  });
});

describe("topPairIds", () => {
  it("takes the highest counts, in order", () => {
    const result = topPairIds(
      new Map([
        ["cap", 1],
        ["shorts", 5],
        ["socks", 3],
      ]),
      2,
    );
    expect(result).toStrictEqual(["shorts", "socks"]);
  });

  it("takes an item that was worn together exactly once", () => {
    // The starting "best" has to sit below the smallest real count, or a
    // pair seen once is never anyone's pair.
    expect(topPairIds(new Map([["cap", 1]]), 2)).toStrictEqual(["cap"]);
  });

  it("keeps the first of two equal counts rather than the last", () => {
    // Ties are common early on, when everything has been worn once. Which
    // one wins is arbitrary; that it is stable is not.
    expect(
      topPairIds(
        new Map([
          ["shorts", 2],
          ["socks", 2],
        ]),
        1,
      ),
    ).toStrictEqual(["shorts"]);
  });

  it("stops when there is nothing left rather than padding", () => {
    expect(topPairIds(new Map([["shorts", 5]]), 2)).toStrictEqual(["shorts"]);
    expect(topPairIds(new Map(), 2)).toStrictEqual([]);
  });

  it("never returns the same id twice", () => {
    // The taken id is removed as it is taken; without that the top count
    // fills every slot.
    const result = topPairIds(
      new Map([
        ["shorts", 5],
        ["socks", 3],
      ]),
      2,
    );
    expect(new Set(result).size).toBe(result.length);
  });

  it("leaves the caller's map alone", () => {
    const counts = new Map([["shorts", 5]]);
    topPairIds(counts, 2);
    expect(counts.get("shorts")).toBe(5);
  });
});
