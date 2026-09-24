import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildCoOccurrence,
  classifyPerformance,
  summarizeByItem,
  pairsFor,
  topPairs,
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
    runCount: 0,
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
    retired: false,
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
      runCount: 3,
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

  it("groups the items worn together in each dialed entry", () => {
    const { dialedKits } = summarizeByItem([
      row({ entryId: "run-1", itemId: "shirt" }),
      row({ entryId: "run-1", itemId: "shorts" }),
      row({ entryId: "run-2", itemId: "shirt" }),
    ]);
    expect(dialedKits.get("run-1")).toStrictEqual(["shirt", "shorts"]);
    expect(dialedKits.get("run-2")).toStrictEqual(["shirt"]);
  });

  it("never offers a retired piece as a pairing, though its own history counts", () => {
    const { dialedKits, summaries } = summarizeByItem([
      row({ entryId: "run-1", itemId: "shirt" }),
      row({ entryId: "run-1", itemId: "old-shorts", retired: true }),
    ]);
    expect(dialedKits.get("run-1")).toStrictEqual(["shirt"]);
    expect(summaries.get("old-shorts")?.dialedCount).toBe(1);
  });

  it("leaves a kit out of the pairings unless the run was dialed", () => {
    // "PAIRS WITH · WHEN DIALED": a pair worn on a run that went wrong,
    // or one nobody rated, is not a pairing to repeat.
    const { dialedKits } = summarizeByItem([
      row({ entryId: "cold", itemId: "shirt", verdict: -1 }),
      row({ entryId: "unrated", itemId: "shirt", verdict: unrated() }),
    ]);
    expect(dialedKits.size).toBe(0);
  });

  it("counts every run a piece was worn on, rated or not", () => {
    const { summaries } = summarizeByItem([
      row({ entryId: "a", verdict: -2 }),
      row({ entryId: "b", verdict: unrated() }),
    ]);
    expect(summaries.get("item-1")?.runCount).toBe(2);
  });
});

describe("co-occurrence", () => {
  it("counts a pair once per entry, in both directions", () => {
    const counts = buildCoOccurrence(new Map([["run-1", ["shirt", "shorts"]]]));
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

describe("topPairs", () => {
  it("takes the highest counts, in order, with the count", () => {
    const result = topPairs(
      new Map([
        ["cap", 1],
        ["shorts", 5],
        ["socks", 3],
      ]),
      2,
    );
    expect(result).toStrictEqual([
      { itemId: "shorts", count: 5 },
      { itemId: "socks", count: 3 },
    ]);
  });

  it("takes an item that was worn together exactly once", () => {
    // The starting "best" has to sit below the smallest real count, or a
    // pair seen once is never anyone's pair.
    expect(topPairs(new Map([["cap", 1]]), 2)).toStrictEqual([
      { itemId: "cap", count: 1 },
    ]);
  });

  it("keeps the first of two equal counts rather than the last", () => {
    // Ties are common early on, when everything has been worn once. Which
    // one wins is arbitrary; that it is stable is not.
    expect(
      topPairs(
        new Map([
          ["shorts", 2],
          ["socks", 2],
        ]),
        1,
      ),
    ).toStrictEqual([{ itemId: "shorts", count: 2 }]);
  });

  it("stops when there is nothing left rather than padding", () => {
    expect(topPairs(new Map(), 2)).toStrictEqual([]);
  });

  it("leaves the caller's map alone", () => {
    const counts = new Map([["shorts", 5]]);
    topPairs(counts, 2);
    expect(counts.get("shorts")).toBe(5);
  });
});

describe("pairsFor (round 22: up to three, absent under 3 runs)", () => {
  const four = new Map([
    ["a", 4],
    ["b", 3],
    ["c", 2],
    ["d", 1],
  ]);

  it("says nothing for a piece with two runs, however they paired", () => {
    expect(pairsFor(summary({ runCount: 2 }), four)).toStrictEqual([]);
  });

  it("lists up to three once the piece has three runs", () => {
    expect(
      pairsFor(summary({ runCount: 3 }), four).map((pair) => pair.itemId),
    ).toStrictEqual(["a", "b", "c"]);
  });

  it("lists nothing for a piece never dialed alongside anything", () => {
    expect(pairsFor(summary({ runCount: 9 }), undefined)).toStrictEqual([]);
  });
});
