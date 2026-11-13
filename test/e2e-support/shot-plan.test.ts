import { describe, expect, it } from "vitest";

import {
  CAP_PER_ROUTE,
  describePart,
  forcedKey,
  withForcedKey,
  indexLine,
  maxHeightFrom,
  routeOf,
  SHOT_ORDER,
  SHOT_SIZES,
  ShotLedger,
  shotHeight,
  shotName,
  slugOf,
  STATE_ATTRIBUTES,
  stateKey,
} from "../../e2e/audit/shot-plan";

const row = (route: string, key: string) => ({
  key,
  route,
  url: `http://localhost:3000${route}`,
  test: "closet > adds a garment",
  width: 1280,
  files: [`shots/${route}/01-phone-light.png`],
});

describe("routeOf", () => {
  it("keeps a screen's own path segments", () => {
    expect(routeOf("/closet/new", "")).toBe("/closet/new");
  });

  it("folds a long id, a numbered handle and a number into :id", () => {
    expect(routeOf("/runs/01JD4Z8Q9X2M3N4P5R6S7T8V9W", "")).toBe("/runs/:id");
    expect(routeOf("/feed/u/trail_604311", "")).toBe("/feed/u/:id");
    expect(routeOf("/desk/page/12", "")).toBe("/desk/page/:id");
  });

  it("keeps a segment one short of an id, and a handle whose digits are not six", () => {
    expect(routeOf("/x/abcdefghijklmno", "")).toBe("/x/abcdefghijklmno");
    expect(routeOf("/feed/u/trail_60431", "")).toBe("/feed/u/trail_60431");
    expect(routeOf("/feed/u/trail_6043112x", "")).toBe("/feed/u/trail_6043112x");
    expect(routeOf("/v2", "")).toBe("/v2");
    expect(routeOf("/x/12abc", "")).toBe("/x/12abc");
  });

  it("folds a sixteen-character segment", () => {
    expect(routeOf("/x/abcdefghijklmnop", "")).toBe("/x/:id");
  });

  it("reduces the query to its keys, sorted, whatever their values", () => {
    expect(routeOf("/desk/runners", "?query=maya&filter=flagged")).toBe(
      "/desk/runners?filter&query",
    );
    expect(routeOf("/desk/runners", "?filter=all&query=x")).toBe(
      routeOf("/desk/runners", "?query=y&filter=none"),
    );
  });
});

describe("describePart", () => {
  it("writes the parent, tag, slot and every state in order", () => {
    expect(
      describePart({
        parent: "FORM",
        tag: "BUTTON",
        slot: "submit",
        states: [
          ["aria-busy", "true"],
          ["aria-disabled", ""],
        ],
      }),
    ).toBe("FORM>BUTTON.submit[aria-busy=true,aria-disabled=]");
  });

  it("writes an element with no states as empty brackets", () => {
    expect(describePart({ parent: "", tag: "MAIN", slot: "", states: [] })).toBe(">MAIN.[]");
  });
});

describe("stateKey", () => {
  it("is the route and a hash", () => {
    expect(stateKey("/closet", ["BODY>MAIN.[]"])).toMatch(/^\/closet#-?\d+$/u);
  });

  it("does not depend on the order the parts were found in, or repeats", () => {
    expect(stateKey("/closet", ["a", "b", "c"])).toBe(stateKey("/closet", ["c", "a", "b", "a"]));
  });

  it("changes when a part changes, appears or goes", () => {
    const base = stateKey("/closet", ["DIV>BUTTON.[aria-pressed=false]"]);
    expect(stateKey("/closet", ["DIV>BUTTON.[aria-pressed=true]"])).not.toBe(base);
    expect(stateKey("/closet", ["DIV>BUTTON.[aria-pressed=false]", "BODY>DIALOG.[open=]"])).not.toBe(
      base,
    );
    expect(stateKey("/closet", [])).toBe("/closet#0");
  });

  it("depends on every character of a part, the first included", () => {
    expect(stateKey("/r", ["ab"])).not.toBe(stateKey("/r", ["bb"]));
    expect(stateKey("/r", ["ab"])).not.toBe(stateKey("/r", ["ac"]));
    expect(stateKey("/r", ["ab"])).not.toBe(stateKey("/r", ["ba"]));
  });

  it("computes the known 31-multiplier hash of one part", () => {
    // "ab": 97 * 31 + 98.
    expect(stateKey("/r", ["ab"])).toBe("/r#3105");
  });

  it("wraps to a 32-bit integer however many parts there are", () => {
    const parts = Array.from({ length: 400 }, (_, index) => `HTML>DIV.part-${String(index)}[open=]`);
    const hash = Number(stateKey("/r", parts).split("#", 2)[1]);
    expect(Number.isSafeInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(hash).toBeLessThan(2 ** 31);
  });

  it("hashes the parts in text order, not the page's", () => {
    // "a" then "b": 97 * 31 + 98. In page order, "b" then "a", it would be 3135.
    expect(stateKey("/r", ["b", "a"])).toBe("/r#3105");
  });
});

describe("slugOf", () => {
  it("joins a route's words with single underscores, keeping : and @", () => {
    expect(slugOf("/feed/attach/:id")).toBe("feed_attach_:id");
    expect(slugOf("/desk/runners?filter&query")).toBe("desk_runners_filter_query");
    expect(slugOf("/@maya")).toBe("@maya");
    expect(slugOf("/a-b")).toBe("a-b");
  });

  it("names the root route", () => {
    expect(slugOf("/")).toBe("root");
    expect(slugOf("")).toBe("root");
  });
});

describe("the shot matrix", () => {
  it("takes the phone and the desk, light then dark", () => {
    expect(SHOT_ORDER).toEqual([
      { scheme: "light", size: "phone" },
      { scheme: "light", size: "desk" },
      { scheme: "dark", size: "phone" },
      { scheme: "dark", size: "desk" },
    ]);
    expect(SHOT_SIZES).toEqual({
      phone: { width: 390, height: 844 },
      desk: { width: 1280, height: 800 },
    });
  });

  it("names a shot by its state number, padded, then size and scheme", () => {
    expect(shotName(3, { scheme: "dark", size: "phone" })).toBe("03-phone-dark.png");
    expect(shotName(12, { scheme: "light", size: "desk" })).toBe("12-desk-light.png");
  });

  it("watches the attributes that change a screen's state", () => {
    expect(STATE_ATTRIBUTES).toEqual([
      "aria-pressed",
      "aria-checked",
      "aria-selected",
      "aria-invalid",
      "aria-expanded",
      "aria-current",
      "aria-busy",
      "aria-disabled",
      "open",
      "data-state",
    ]);
  });
});

describe("shotHeight", () => {
  it("grows to the document", () => {
    expect(shotHeight(2400, 844, 9000)).toBe(2400);
  });

  it("never shrinks below the viewport", () => {
    expect(shotHeight(500, 844, 9000)).toBe(844);
  });

  it("stops at the cap", () => {
    expect(shotHeight(12_000, 844, 9000)).toBe(9000);
  });
});

describe("maxHeightFrom", () => {
  it("defaults to 9000 px", () => {
    expect(maxHeightFrom(undefined)).toBe(9000);
    expect(maxHeightFrom("")).toBe(9000);
  });

  it("reads a positive whole number", () => {
    expect(maxHeightFrom("14000")).toBe(14_000);
  });

  it("ignores anything else", () => {
    expect(maxHeightFrom("tall")).toBe(9000);
    expect(maxHeightFrom("0")).toBe(9000);
    expect(maxHeightFrom("-5")).toBe(9000);
    expect(maxHeightFrom("1.5")).toBe(9000);
  });
});

describe("ShotLedger", () => {
  it("numbers new states on a route from 1", () => {
    const ledger = new ShotLedger();
    expect(ledger.claim("/closet", "/closet#1")).toBe(1);
    expect(ledger.claim("/closet", "/closet#2")).toBe(2);
    expect(ledger.claim("/runs", "/runs#1")).toBe(1);
  });

  it("refuses a state it has shot", () => {
    const ledger = new ShotLedger();
    ledger.claim("/closet", "/closet#1");
    expect(ledger.claim("/closet", "/closet#1")).toBeUndefined();
    expect(ledger.claim("/closet", "/closet#2")).toBe(2);
  });

  it("stops a route at the cap and leaves other routes alone", () => {
    const ledger = new ShotLedger();
    for (let index = 1; index <= CAP_PER_ROUTE; index += 1) {
      expect(ledger.claim("/feed", `/feed#${String(index)}`)).toBe(index);
    }
    expect(ledger.claim("/feed", "/feed#overflow")).toBeUndefined();
    expect(ledger.claim("/runs", "/runs#1")).toBe(1);
    expect(CAP_PER_ROUTE).toBe(16);
  });

  it("carries on from an earlier run's index, skipping blank lines", () => {
    const index = [indexLine(row("/closet", "/closet#1")), "\n", "   \n", indexLine(row("/closet", "/closet#2"))].join("");
    const ledger = new ShotLedger(index);
    expect(ledger.claim("/closet", "/closet#1")).toBeUndefined();
    expect(ledger.claim("/closet", "/closet#3")).toBe(3);
  });

  it("refuses an index line that is not a row", () => {
    expect(() => new ShotLedger('{"key":"x"}\n')).toThrow(/route/u);
    expect(() => new ShotLedger("not json\n")).toThrow(SyntaxError);
  });
});

describe("indexLine", () => {
  it("is one JSON line that reads back as the row", () => {
    const line = indexLine(row("/closet", "/closet#1"));
    expect(line.endsWith("}\n")).toBe(true);
    expect(line.split("\n")).toHaveLength(2);
    expect(JSON.parse(line)).toEqual(row("/closet", "/closet#1"));
  });

  it("refuses a row with an empty key or a width that is not a positive integer", () => {
    expect(() => indexLine({ ...row("/a", "k"), key: "" })).toThrow();
    expect(() => indexLine({ ...row("/a", "k"), width: 0 })).toThrow();
    expect(() => indexLine({ ...row("/a", "k"), width: 1.5 })).toThrow();
  });
});

describe("forcedKey", () => {
  it("is z- and the name's words, lowercased and joined by single dashes", () => {
    expect(forcedKey("Upload: in progress, Parsed!")).toBe("z-upload-in-progress-parsed");
    expect(forcedKey("Step 2")).toBe("z-step-2");
  });

  it("keeps at most forty characters of words", () => {
    expect(forcedKey("a".repeat(50))).toBe(`z-${"a".repeat(40)}`);
  });
});

describe("withForcedKey", () => {
  it("adds the state's key, keeping the other parameters and the hash", () => {
    expect(withForcedKey("http://localhost:3000/runs/new?from=strava#top", "Parsed")).toBe(
      "http://localhost:3000/runs/new?from=strava&z-parsed=1#top",
    );
  });

  it("replaces an earlier state's key rather than piling them up", () => {
    expect(withForcedKey("http://localhost:3000/runs/new?z-parsed=1&zone=a", "Failed")).toBe(
      "http://localhost:3000/runs/new?zone=a&z-failed=1",
    );
  });
});
