import { describe, expect, it } from "vitest";

import doctrine from "../../design/motion.js?raw";
import navSource from "../../src/lib/nav-types.ts?raw";
import {
  NAV_TYPES,
  isLogFlowPath,
  viewTransitionTypes,
  viewTransitionTypesFor,
} from "../../src/lib/nav-types";
import { repoPath, withoutComments } from "../architecture/source-text";

/**
 * The port of design round 12's `NAV` against the table it came from, and
 * against the app it has to cover.
 *
 * jsdom has no `startViewTransition` and workerd has no DOM at all, so
 * nothing here can watch a transition run. What it can do is pin the
 * decision, which is the whole of this lane's logic: the resolver is a pure
 * function of two pathnames, and every case below is one edge a runner can
 * actually travel.
 */

/**
The doctrine is untyped JS in a read-only archive; read it as text.
*/
const contract = withoutComments(doctrine);

/**
 * Which of the five types a forward navigation is, read back out of the
 * emitted view-transition types.
 *
 * The resolver has one public entry point on purpose — what the router
 * hands the browser is the only thing that matters — so the tests ask it
 * the same question the router does rather than through a seam that exists
 * only for them.
 */
function typeOf(from: string | undefined, to: string, isBack = false): string {
  const types = viewTransitionTypes(from, to, isBack);
  return types === undefined ? "cut" : types.join("+").replaceAll("nav-", "");
}

describe("the five types", () => {
  it("are the doctrine's five, and no sixth", () => {
    // `NAV_TYPES` is an object literal in the archive: `push: {...}`, one
    // per line at two spaces of indent.
    const open = contract.indexOf("export const NAV_TYPES = {");
    const declared: string[] = [];
    for (const match of contract
      .slice(open)
      .matchAll(/^ {2}(\w+):\s*\{ move:/gm)) {
      const name = match[1];
      if (name !== undefined) declared.push(name);
    }

    expect(declared).toEqual(["push", "rise", "swap", "panel", "cut"]);
    expect([...NAV_TYPES]).toEqual(declared);
  });

  it("keeps the NEVER entry that forbids a sixth", () => {
    // If this sentence leaves the doctrine, the table above stops being a
    // closed set and this suite stops meaning what it says.
    expect(contract).toContain("never a sixth type");
    expect(contract).toContain("Shared-element transitions between screens");
  });

  it("carries round 12's reduced-motion clause", () => {
    // The CSS half is pinned in `motion-css.dom.test.tsx`; this is the
    // half that says the clause is still in the contract at all.
    expect(contract).toContain("Every navigation type becomes swap at instant");
  });
});

describe("which type an edge resolves to", () => {
  it("cuts when there is no screen to come from", () => {
    // NAV: "Deep link / notification tap → any" and "First paint of any
    // screen" — "There is no 'from'. Arrive, then the screen's own reveal
    // (if any) runs."
    expect(typeOf(undefined, "/feed/entry/e1")).toBe("cut");
    expect(typeOf(undefined, "/closet/new")).toBe("cut");
    // Even for an edge that would otherwise be the loudest move in the app.
    expect(typeOf(undefined, "/runs/new")).toBe("cut");
  });

  it("cuts between the tabs, and never to the launcher's flow", () => {
    // NAV: "Tab bar → Feed / Closet / Call / You" — "Indicator slides.
    // Content cuts." Every ordered pair, so no tab is special.
    const tabs = ["/feed", "/closet", "/call", "/feed/me"];
    for (const from of tabs) {
      for (const to of tabs) {
        expect([from, to, typeOf(from, to)]).toEqual([from, to, "cut"]);
      }
    }
  });

  it("cuts when the path has not changed", () => {
    // A new search param or hash on the screen you are already on. Nothing
    // moved, so nothing should move.
    expect(typeOf("/closet", "/closet")).toBe("cut");
  });

  it("rises into a flow and drops out of it", () => {
    // NAV: "+ Add (bar launcher) → Log a run (A1…Q)", and "Closet C → Add
    // garment (F)" — "Same rise as Log a run — both are 'put something in
    // the closet'."
    expect(typeOf("/feed", "/runs/new")).toBe("rise");
    expect(typeOf("/closet", "/runs/new")).toBe("rise");
    expect(typeOf("/closet", "/closet/new")).toBe("rise");
    expect(typeOf("/feed/me", "/closet/new")).toBe("rise");

    // NAV: "Log flow end (P3) → where you were" — "The drop half of rise."
    // A forward navigation that plays the type backwards, which is why the
    // row carries `reversed` rather than leaning on the history. Typed by
    // analogy: this app lands on what the flow made, not on the prior
    // screen. See docs/designs/117-navigation-types.md, question 1.
    expect(typeOf("/feed/verdict/e1", "/feed/entry/e1")).toBe("rise+back");
    expect(typeOf("/runs/manual", "/runs/r1")).toBe("rise+back");
  });

  it("leaves the way it came", () => {
    // "Back feels like back because the screen physically goes back." The
    // table is written forwards, so a back navigation is looked up as the
    // edge it is undoing — without that, leaving a garment matches the
    // *tab* row and the runner gets no move at all.
    expect(typeOf("/closet/g1", "/closet", true)).toBe("push+back");
    expect(typeOf("/feed/entry/e1", "/feed", true)).toBe("push+back");
    // Dismissing the flow is the drop.
    expect(typeOf("/runs/new", "/feed", true)).toBe("rise+back");
    expect(typeOf("/closet/new", "/closet", true)).toBe("rise+back");
    // And a back that undoes a cut is still a cut.
    expect(typeOf("/closet", "/feed", true)).toBe("cut");
    expect(typeOf("/runs/manual", "/runs/new", true)).toBe("cut");
  });

  it("rises back into a flow whose exit already read backwards", () => {
    // The one case where the two reversals cancel: the exit is a forward
    // navigation playing the drop, so pressing back along it plays the
    // rise. Read either flag on its own and this comes out as a drop into
    // the screen the runner is arriving at.
    expect(typeOf("/feed/entry/e1", "/feed/verdict/e1", true)).toBe("rise");
    expect(typeOf("/runs/r1", "/runs/manual", true)).toBe("rise");
  });

  it("cuts between the steps inside a flow, because FlowStep owns them", () => {
    // NAV's own note on the launcher row: "Steps inside: Log flow step" —
    // which assigns the move to the per-surface map, not to a navigation
    // type. Both halves animating is two moves on one navigation.
    expect(typeOf("/runs/new", "/runs/manual")).toBe("cut");
    expect(typeOf("/feed/attach/r1", "/feed/verdict/e1")).toBe("cut");
    // Including backwards through the flow.
    expect(typeOf("/runs/manual", "/runs/new")).toBe("cut");
  });

  it("pushes into a verdict reached from outside the flow", () => {
    // NAV: "S1 prompt → Verdict (A3)". The contract rules on the *edge*,
    // and this one is arriving rather than resuming — so it beats the
    // flow-internal cut above, which is why its row sits higher.
    expect(typeOf("/notifications", "/feed/verdict/e1")).toBe("push");
    expect(typeOf("/feed/entry/e1", "/feed/verdict/e1")).toBe("push");
  });

  it("swaps between sign in and sign up, both ways", () => {
    // NAV: "Siblings, no hierarchy — neither is 'forward'."
    expect(typeOf("/auth/login", "/auth/signup")).toBe("swap");
    expect(typeOf("/auth/signup", "/auth/login")).toBe("swap");
    // NAV: "First load (/) → Sign in" and "Sign out → Sign in" are cuts.
    expect(typeOf("/", "/auth/login")).toBe("cut");
  });

  it("pushes everywhere the runner goes deeper", () => {
    for (const [from, to] of [
      ["/closet", "/closet/g1"],
      ["/closet/g1", "/closet/edit/g1"],
      ["/feed", "/feed/entry/e1"],
      ["/feed/me", "/feed/entry/e1"],
      ["/feed/entry/e1", "/feed/u/u1"],
      ["/feed", "/feed/search"],
      ["/runs", "/runs/r1"],
      ["/runs/import/i1", "/runs/r1"],
      ["/feed", "/notifications"],
      ["/closet", "/notifications"],
      ["/runs", "/runs/strava"],
      ["/onboarding/name", "/onboarding/calibrate"],
      ["/onboarding/taplist", "/onboarding/done"],
    ] as const) {
      expect([from, to, typeOf(from, to)]).toEqual([from, to, "push"]);
    }
  });

  it("cuts the OAuth return, which is a document load", () => {
    // NAV: "A document load from another origin. There is no outgoing
    // screen." Nothing here can run; the row stops it being typed later.
    expect(typeOf("/runs/strava", "/runs/strava-callback")).toBe("cut");
  });

  it("does not let a route param swallow a longer path", () => {
    // `/closet/$itemId` is one segment, so it must not claim
    // `/closet/edit/g1` — which is a different row with a different type,
    // and would be shadowed by a looser match.
    expect(typeOf("/feed", "/closet/edit/g1")).toBe("push");
    // …nor an empty one. `/closet/` is the closet, not a garment.
    expect(typeOf("/feed", "/closet/")).toBe("cut");
  });
});

describe("viewTransitionTypes", () => {
  it("answers a cut with no types at all", () => {
    // "No transition" is a fact about the edge, so it is `undefined` here;
    // `false` is how TanStack spells it and is applied once, at the
    // boundary below. Either way the router calls the update directly and
    // the browser never snapshots the viewport.
    expect(viewTransitionTypes("/feed", "/closet", false)).toBeUndefined();
    expect(viewTransitionTypes(undefined, "/feed", false)).toBeUndefined();
  });

  it("names the type, and says when it is reversed", () => {
    expect(viewTransitionTypes("/closet", "/closet/g1", false)).toEqual([
      "nav-push",
    ]);
    // "Back reverses both" — carried as a second type so the CSS says in
    // one place what reverses and what does not, rather than doubling the
    // rules.
    expect(viewTransitionTypes("/closet/g1", "/closet", true)).toEqual([
      "nav-push",
      "nav-back",
    ]);
    expect(viewTransitionTypes("/feed", "/runs/new", false)).toEqual([
      "nav-rise",
    ]);
    expect(viewTransitionTypes("/auth/login", "/auth/signup", false)).toEqual([
      "nav-swap",
    ]);
  });

  it("stays a cut on the way back too", () => {
    // Back out of a tab switch is still a tab switch.
    expect(viewTransitionTypes("/closet", "/feed", true)).toBeUndefined();
    // …and the boundary turns that into the `false` the router reads.
    expect(
      viewTransitionTypesFor({
        fromLocation: at("/closet", 2),
        toLocation: at("/feed", 1),
      }),
    ).toBe(false);
  });
});

describe("isLogFlowPath", () => {
  it("is the four screens that render a step, and nothing else", () => {
    for (const path of [
      "/runs/new",
      "/runs/manual",
      "/feed/attach/r1",
      "/feed/verdict/e1",
    ]) {
      expect([path, isLogFlowPath(path)]).toEqual([path, true]);
    }
    // The import screen is progress on a job, not a step of the flow —
    // which is why leaving A1 for it counts as leaving the flow.
    for (const path of [
      "/runs/import/i1",
      "/runs/r1",
      "/feed/entry/e1",
      "/feed",
      "/closet/new",
    ]) {
      expect([path, isLogFlowPath(path)]).toEqual([path, false]);
    }
  });
});

/**
 * Every destination the app can navigate to is claimed by a row.
 *
 * This is the enforceable half of the `NAV` header's ownership rule — "a
 * lane meeting a new edge assigns a type by analogy to the nearest row,
 * adds the row in the same PR, and flags it". A lane that adds a `Link` to
 * a screen nobody has typed fails here, naming the path, rather than
 * shipping a navigation that silently falls through to `cut`.
 *
 * Source text rather than the resolver, deliberately: `cut` is a real
 * answer *and* the default, so calling the function cannot distinguish "the
 * table says stillness" from "the table has never heard of this".
 */
const sources = import.meta.glob<string>("../../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Every `to="/…"` and `to: "/…"` in one file — a typed `Link`'s target and
 * a `navigate`'s, which are the only two ways this app changes screen.
 */
function navigationsIn(source: string): string[] {
  const found: string[] = [];
  for (const match of withoutComments(source).matchAll(
    /\bto:\s*"(\/[^"]*)"|\bto="(\/[^"]*)"/g,
  )) {
    const to = match[1] ?? match[2];
    if (to !== undefined) found.push(to);
  }
  return found;
}

describe("the table covers the app", () => {
  const table = withoutComments(navSource);

  const destinations = new Map<string, string[]>();
  for (const [globPath, source] of Object.entries(sources)) {
    const path = repoPath(globPath);
    if (path === "src/lib/nav-types.ts") continue;
    for (const to of navigationsIn(source)) {
      destinations.set(to, [...(destinations.get(to) ?? []), path]);
    }
  }

  it("found the navigations, so nothing below is vacuous", () => {
    // If the scanner stops matching, every assertion under it passes over
    // an empty set. The repo had 24 distinct destinations when this was
    // written; the floor is deliberately loose, the zero-check is not.
    expect(destinations.size).toBeGreaterThanOrEqual(20);
    expect(destinations.has("/runs/new")).toBe(true);
  });

  it("types every destination a component navigates to", () => {
    const untyped: string[] = [];
    for (const [to, files] of destinations) {
      if (table.includes(`"${to}"`)) continue;
      untyped.push(`${to} (from ${files.join(", ")})`);
    }

    // An empty array, compared as an array, so the failure names the path
    // and the file rather than saying `false !== true`.
    expect(untyped).toEqual([]);
  });
});

/**
 * One end of a navigation, in the shape the router hands over.
 */
function at(pathname: string, index: number) {
  return { pathname, state: { __TSR_index: index } };
}

/**
 * The router's own entry point.
 *
 * `src/router.tsx` holds a reference to this and nothing else, because
 * nothing in that file can be reached by a test: `routeTree.gen` pulls
 * every route and a route pulls server functions. Reading the history
 * index is therefore checked here, where a mutant can be killed.
 */
describe("viewTransitionTypesFor", () => {
  it("reads back and forward off the history index", () => {
    // Forward: the index goes up.
    expect(
      viewTransitionTypesFor({
        fromLocation: at("/closet", 3),
        toLocation: at("/closet/g1", 4),
      }),
    ).toEqual(["nav-push"]);

    // Back: the index goes down, and the move reverses rather than
    // replaying. Same pair of paths, opposite answer — which is the whole
    // reason the index is read at all.
    expect(
      viewTransitionTypesFor({
        fromLocation: at("/closet/g1", 4),
        toLocation: at("/closet", 3),
      }),
    ).toEqual(["nav-push", "nav-back"]);
  });

  it("treats a first paint as an arrival, never as a step backwards", () => {
    // No previous entry at all. The answer is a cut either way, but the
    // fallback must not read as "this went backwards" — index 0 is a real
    // index, so a `?? 0` here would call the very first navigation a back.
    expect(
      viewTransitionTypesFor({ toLocation: at("/feed/entry/e1", 0) }),
    ).toBe(false);
    expect(viewTransitionTypesFor({ toLocation: at("/runs/new", 0) })).toBe(
      false,
    );
  });

  it("passes the pathnames through, not the hrefs", () => {
    // A rise is the loudest move in the app and the easiest to lose to a
    // wrong field; this is the end-to-end shape the router actually calls.
    expect(
      viewTransitionTypesFor({
        fromLocation: at("/closet", 1),
        toLocation: at("/runs/new", 2),
      }),
    ).toEqual(["nav-rise"]);
  });
});
