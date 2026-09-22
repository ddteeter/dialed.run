import { describe, expect, it } from "vitest";

import { LAUNCHER, TABS } from "../../src/ui/tabs";

/**
 * The table both bars read.
 *
 * `activeTabIndex` and `tabToLight` are exercised where the move they
 * serve is — `test/ui/motion-surfaces.dom.test.tsx`, under "Tab switch".
 * What is here is the fact that made this file its own module: the
 * Desktop Contract's *"same four destinations, same order"* is a claim
 * about two components, and the only way to hold it is to give them one
 * array. These cases are what fails if a later lane gives the wide bar its
 * own.
 */
describe("the bar table", () => {
  it("holds five seats, of which exactly one is the launcher", () => {
    // Five seats and four tabs: the launcher takes a seat and owns no
    // path (round 12), which is what `activeTabIndex` skips and what makes
    // the phone indicator one *fifth* of the track.
    expect(TABS).toHaveLength(5);
    expect(TABS.filter((tab) => "launcher" in tab)).toHaveLength(1);
  });

  it("names the launcher's seat without restating its path", () => {
    // `LAUNCHER` is `TABS[2]` — a tuple index rather than a search, so
    // there is no unreachable fallback arm. This is what says the index
    // really is the flagged seat, so moving the launcher in the array
    // fails here rather than silently pointing the wide bar's pill at a
    // tab.
    expect(LAUNCHER).toBe(TABS[2]);
    expect("launcher" in LAUNCHER).toBe(true);
    expect(LAUNCHER.to).toBe("/runs/new");
  });

  it("is the four destinations in the order the contract names them", () => {
    // DS1: "same four destinations, same order, as four text links". The
    // order is load-bearing twice over — it is also the phone indicator's
    // position — so it is pinned rather than left to whoever edits next.
    expect(
      TABS.filter((tab) => !("launcher" in tab)).map((tab) => [
        tab.label,
        tab.to,
      ]),
    ).toStrictEqual([
      ["Feed", "/feed"],
      ["Closet", "/closet"],
      ["Call", "/call"],
      ["You", "/feed/me"],
    ]);
  });
});
