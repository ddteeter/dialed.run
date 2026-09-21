import { describe, expect, it } from "vitest";

import doctrine from "../../design/motion.js?raw";
import {
  NAV_TYPES,
  isLogFlowPath,
  navTypeFor,
  viewTransitionTypes,
  viewTransitionTypesFor,
} from "../../src/lib/nav-types";
import {
  isInstrumented,
  repoPath,
  withoutComments,
} from "../architecture/source-text";

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
    // On a screen a row *would* claim, which is the case that says this is
    // a guard rather than a coincidence: without it, a garment detail
    // re-reading its own search params would push over itself.
    expect(typeOf("/closet/g1", "/closet/g1")).toBe("cut");
    expect(navTypeFor("/closet/g1", "/closet/g1", false)).toBe("cut");
    expect(typeOf("/runs/new", "/runs/new")).toBe("cut");
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
    // Uniform for the whole class, including the import screen: watching a
    // job is a destination, not a step, so reaching it leaves the flow.
    expect(typeOf("/runs/new", "/runs/import/i1")).toBe("rise+back");
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
      ["/feed/me", "/runs"],
      ["/runs", "/runs/strava"],
      ["/", "/onboarding/name"],
      ["/onboarding/name", "/onboarding/calibrate"],
      ["/onboarding/calibrate", "/onboarding/taplist"],
      ["/onboarding/taplist", "/onboarding/settings"],
      ["/onboarding/settings", "/onboarding/done"],
    ] as const) {
      expect([from, to, typeOf(from, to)]).toEqual([from, to, "push"]);
    }
  });

  it("rules on stillness rather than leaving it unclaimed", () => {
    // These rows all answer `cut`, which is also what an edge nobody has
    // typed does at runtime — so without something holding them apart the
    // rows are unwritable and unkillable both. `navTypeFor` keeps them
    // apart: a row says the doctrine looked, `undefined` says it did not.
    for (const [from, to] of [
      ["/closet", "/feed"],
      ["/feed", "/closet"],
      ["/feed", "/call"],
      ["/feed", "/feed/me"],
      ["/feed/me", "/feed"],
      ["/call", "/closet"],
      ["/", "/auth/login"],
      ["/onboarding/done", "/"],
      ["/runs/strava", "/runs/strava-callback"],
    ] as const) {
      expect([from, to, navTypeFor(from, to, false)]).toEqual([
        from,
        to,
        "cut",
      ]);
    }

    // The distinction itself. A screen no row mentions is not "ruled a
    // cut"; it is a row somebody owes the table.
    expect(navTypeFor("/feed", "/nowhere", false)).toBeUndefined();
    expect(navTypeFor("/nowhere", "/elsewhere", false)).toBeUndefined();
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
 * shipping a navigation nobody ruled on.
 *
 * It asks the resolver rather than reading the table's source, which is
 * only possible because `navTypeFor` keeps "typed `cut`" and "no row"
 * apart. They behave alike at runtime and must not be confused here: a row
 * that cannot be told from its own absence is a row no test can hold.
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

/**
 * Somewhere a runner can plausibly be standing when they leave for
 * anywhere: the four tabs, plus the two screens that reach the rest.
 */
const FROMS = [
  "/feed",
  "/closet",
  "/call",
  "/feed/me",
  "/",
  "/auth/login",
  "/notifications",
  "/runs",
  "/onboarding/name",
];

// Deliberately not a log-flow screen. The flow's exit row claims every
// destination (`to: "*"`), so asking from inside the flow would call every
// path in the app typed and this test would pass over an empty table.

describe("the table covers the app", () => {
  const destinations = new Map<string, string[]>();
  for (const [globPath, source] of Object.entries(sources)) {
    const path = repoPath(globPath);
    if (path === "src/lib/nav-types.ts") continue;
    // Stryker instruments in a sandbox copy, and instrumentation wraps
    // every string literal in a ternary — so `to: "/feed"` stops looking
    // like a navigation. Those files are not the repo; skip them rather
    // than read a mutant's idea of where the app can go.
    if (isInstrumented(source)) continue;
    for (const to of navigationsIn(source)) {
      destinations.set(to, [...(destinations.get(to) ?? []), path]);
    }
  }

  it("found the navigations, so nothing below is vacuous", () => {
    // If the scanner stops matching, every assertion under it passes over
    // an empty set. The repo had 24 distinct destinations when this was
    // written, and a stryker sandbox hides however many files that run
    // instruments — so the floor is well under it and the point is that it
    // is not zero.
    expect(destinations.size).toBeGreaterThan(10);
  });

  it("cuts between whatever TabBar's tabs actually are", () => {
    // `NAV`'s tab row is four paths, and `ui/tabs` holds the real list —
    // it moved out of `TabBar.tsx` in task 115, when the top bar became a
    // second reader of the same table. This test is what noticed.
    // Two lists that can disagree without anything failing are a rival
    // truth rather than a duplicate (CLAUDE.md §Derive, don't mirror), so
    // this reads the real one: add a tab, move one, and the pair is
    // checked here rather than drifting.
    const tabBar = sources["../../src/ui/tabs.ts"] ?? "";
    if (isInstrumented(tabBar)) return;

    // Every bar entry except the launcher, which owns no path at all.
    const tabs = withoutComments(tabBar)
      .split("\n")
      .filter((line) => line.includes("to:") && !line.includes("launcher"))
      .flatMap((line) => navigationsIn(line));

    expect(tabs).toEqual(["/feed", "/closet", "/call", "/feed/me"]);
    for (const from of tabs) {
      for (const to of tabs) {
        expect([from, to, typeOf(from, to)]).toEqual([from, to, "cut"]);
      }
    }
  });

  it("types every destination a component navigates to", () => {
    // Every screen in the app is a plausible "from", and the tabs are on
    // every screen, so the bar is the honest one to ask from.
    const untyped: string[] = [];
    for (const [to, files] of destinations) {
      const isTyped = FROMS.some(
        (from) => navTypeFor(from, to, false) !== undefined,
      );
      if (isTyped) continue;
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

  it("reads an equal index as forward, because a replace is not a back", () => {
    // `router.navigate({ replace: true })` leaves the history index where
    // it was. The runner did not go back — nothing was popped — so the
    // edge is the one written in the table, not its reverse.
    expect(
      viewTransitionTypesFor({
        fromLocation: at("/closet", 3),
        toLocation: at("/closet/g1", 3),
      }),
    ).toEqual(["nav-push"]);
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
