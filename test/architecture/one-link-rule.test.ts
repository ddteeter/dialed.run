import { describe, expect, it } from "vitest";

import { codeOnly, isInstrumented, repoPath } from "./source-text";

/**
 * **One rule decides whether a product link shows** (design 163).
 *
 * The denylist is `safety`'s: `deniedLinksOf` is the only read of it and
 * of where links landed (R-176, design 171), and every surface that shows
 * a link asks closet's `allowedLinksOf`. A
 * second module reading `domain_denylist` is a second copy of the rule —
 * /kit had one — and the two can disagree, which is a denied link shown on
 * the open web while the save path still refuses it.
 *
 * The schema declares the tables, so it is allowed; nothing else outside
 * `modules/safety` may name them in code. A landing read elsewhere would
 * be the same second rule: a redirect that one surface hides and another
 * shows.
 */
const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/**"],
  { query: "?raw", import: "default", eager: true },
);

const DENYLIST =
  /\b(?:domainDenylist|domain_denylist|linkLandings|link_landings)\b/u;

describe("the denylist and its landings", () => {
  it("are read only by modules/safety", () => {
    // The glob reached safety's reader, so an empty answer is not an empty scan.
    expect(Object.keys(production).map((path) => repoPath(path))).toContain(
      "src/modules/safety/denylist.ts",
    );
    const offenders = Object.entries(production)
      .filter(
        ([path, source]) =>
          !repoPath(path).startsWith("src/modules/safety/") &&
          !isInstrumented(source) &&
          DENYLIST.test(codeOnly(source)),
      )
      .map(([path]) => repoPath(path));
    expect(offenders).toEqual([]);
  });
});
