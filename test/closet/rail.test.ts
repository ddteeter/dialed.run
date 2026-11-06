import { describe, expect, it } from "vitest";

import { BAND_COVERED_VERDICTS, type UiGroup } from "../../src/lib/contracts";
import type { TempRange } from "../../src/lib/contracts/thermal";
import {
  coverageOf,
  filterViews,
  railCounts,
  worksAtSpan,
  type RailView,
} from "../../src/modules/closet/filters";

/**
 * Closet C's rail (R-94). Rows are named so a failure says which piece
 * went missing, which is the only way a wrong filter ever shows: the
 * screen looks fine and part of the closet is not on it.
 */
interface NamedView extends RailView {
  name: string;
}

function view(
  name: string,
  uiGroup: UiGroup,
  tempRange: TempRange | undefined,
  verdictCount: number | undefined,
): NamedView {
  return {
    name,
    uiGroup,
    tempRange,
    performance:
      verdictCount === undefined ? undefined : { summary: { verdictCount } },
  };
}

const harrier = view("harrier", "tops", { lowC: 3, highC: 8 }, 9);
const tights = view("tights", "bottoms", { lowC: -10, highC: 4 }, 1);
const singlet = view("singlet", "tops", { lowC: 17 }, 0);
const gloves = view("gloves", "hands_head", undefined, undefined);
const closet = [harrier, tights, singlet, gloves];

const names = (views: readonly NamedView[]): string[] =>
  views.map((each) => each.name);

describe("coverageOf", () => {
  it("is the ladder's rule over a piece's verdicts", () => {
    expect(coverageOf(view("a", "tops", undefined, 0))).toBe("unknown");
    expect(coverageOf(view("b", "tops", undefined, 1))).toBe("partial");
    expect(
      coverageOf(view("c", "tops", undefined, BAND_COVERED_VERDICTS)),
    ).toBe("covered");
  });

  it("calls a piece with no record at all untested", () => {
    expect(coverageOf(gloves)).toBe("unknown");
  });
});

describe("filterViews", () => {
  it("leaves the closet whole with nothing set", () => {
    expect(names(filterViews(closet, {}))).toStrictEqual([
      "harrier",
      "tights",
      "singlet",
      "gloves",
    ]);
  });

  it("narrows by group", () => {
    expect(names(filterViews(closet, { group: "tops" }))).toStrictEqual([
      "harrier",
      "singlet",
    ]);
  });

  it("narrows by coverage", () => {
    expect(names(filterViews(closet, { coverage: "covered" }))).toStrictEqual(
      ["harrier"],
    );
    expect(names(filterViews(closet, { coverage: "partial" }))).toStrictEqual(
      ["tights"],
    );
    expect(names(filterViews(closet, { coverage: "unknown" }))).toStrictEqual(
      ["singlet", "gloves"],
    );
  });

  it("narrows WORKS AT by overlap, open ends included", () => {
    // 5–10°C: the Harrier (3–8) overlaps; the tights stop at 4; the
    // singlet works from 17 up; the gloves state no range.
    expect(names(filterViews(closet, { fromC: 5, toC: 10 }))).toStrictEqual([
      "harrier",
    ]);
    expect(names(filterViews(closet, { fromC: 15 }))).toStrictEqual([
      "singlet",
    ]);
    expect(names(filterViews(closet, { toC: 0 }))).toStrictEqual(["tights"]);
  });

  it("asks every set filter at once", () => {
    expect(
      names(filterViews(closet, { group: "tops", coverage: "unknown" })),
    ).toStrictEqual(["singlet"]);
    expect(
      names(
        filterViews(closet, { group: "bottoms", coverage: "covered", toC: 0 }),
      ),
    ).toStrictEqual([]);
  });
});

describe("railCounts", () => {
  it("counts every row by group and by coverage", () => {
    const counts = railCounts(closet);
    expect(counts.all).toBe(4);
    expect([...counts.groups]).toStrictEqual([
      ["tops", 2],
      ["bottoms", 1],
      ["hands_head", 1],
    ]);
    expect([...counts.coverage]).toStrictEqual([
      ["covered", 1],
      ["partial", 1],
      ["unknown", 2],
    ]);
  });

  it("counts nothing in an empty closet", () => {
    const counts = railCounts([]);
    expect(counts.all).toBe(0);
    expect(counts.groups.size).toBe(0);
    expect(counts.coverage.size).toBe(0);
  });
});

describe("worksAtSpan", () => {
  it("spans the closet's coldest stated end to its warmest", () => {
    expect(worksAtSpan(closet)).toStrictEqual({ lowC: -10, highC: 17 });
  });

  it("reads an open-ended piece by the end it states", () => {
    expect(worksAtSpan([singlet])).toStrictEqual({ lowC: 17, highC: 17 });
    expect(
      worksAtSpan([view("shell", "outer", { highC: 2 }, 0)]),
    ).toStrictEqual({ lowC: 2, highC: 2 });
  });

  it("has no span when no piece states an end", () => {
    expect(worksAtSpan([gloves])).toBeUndefined();
    expect(worksAtSpan([view("x", "tops", {}, 0)])).toBeUndefined();
    expect(worksAtSpan([])).toBeUndefined();
  });
});
