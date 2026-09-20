/**
 * Navigation types — the port of design round 12's `NAV_TYPES` and `NAV`
 * (`design/motion.js`, section 04b of the Motion Doctrine).
 *
 * One law: **every navigation has a direction, and the direction is the
 * transition.** Forward comes from the trailing edge; back leaves the way
 * it came; a flow rises from the bar and drops back to it; a swap into a
 * pane has no direction and so gets no travel.
 *
 * **The router reads the type from the edge, never from the destination.**
 * That is the doctrine's own wording and it is the reason this is a table
 * of `(from, to)` pairs rather than a property of a route: arriving at the
 * verdict screen from a notification is arriving, and arriving at it from
 * the attach step is resuming, and they are not the same move.
 *
 * The values are restated here rather than derived because `design/` is an
 * untyped, read-only archive that nothing in `src/` may import — the same
 * position `ui/motion.ts` and `ui/motion.css` are in. What keeps the copy
 * honest is `test/lib/nav-types.test.ts`, which reads `design/motion.js`
 * off disk and pins this table against it.
 */

/**
 * The five types. There is no sixth — round 12's NEVER list says so
 * outright: _"If an edge isn't in NAV it isn't typed yet. Pick one of the
 * five by analogy, add the row, ship; never a sixth type."_
 */
export const NAV_TYPES = ["push", "rise", "swap", "panel", "cut"] as const;

export type NavType = (typeof NAV_TYPES)[number];

/**
 * One row of `NAV`.
 *
 * Patterns are written exactly as the generated route tree writes them, so
 * a row can be grepped against `src/routeTree.gen.ts`. A `$`-prefixed
 * segment matches any one segment; `*` matches any path at all.
 */
interface Edge {
  /**
  Where the runner is coming from. `*` is "anywhere".
  */
  readonly from: string | readonly string[];
  /**
  Where they are going.
  */
  readonly to: string | readonly string[];
  readonly type: NavType;
  /**
   * This edge plays its type backwards.
   *
   * Only the flow's exit needs it, and it needs it because `rise` is one
   * type describing two moves: the flow rises in and drops out. Leaving
   * the flow is a *forward* navigation that plays the dismiss, so the
   * direction cannot be read from the history alone.
   */
  readonly reversed?: boolean;
}

/**
 * The four screens that render `FlowStep` — the log flow proper.
 *
 * Membership is "renders a flow step", not "is about a run": the import
 * status screen is progress on a job and reads as a destination, which is
 * why it is not here and why leaving A1 for it counts as leaving the flow.
 *
 * `_PATHS` because `ui/FlowStep` exports a `LOG_FLOW` of its own and they
 * are not the same fact: that one is the *order* of the three steps
 * (`{ intake: 1, attach: 2, verdict: 3 }`), this one is the four routes
 * that render them. Two intake routes, one intake step.
 */
const LOG_FLOW_PATHS = [
  "/runs/new",
  "/runs/manual",
  "/feed/attach/$runId",
  "/feed/verdict/$entryId",
] as const;

/**
 * Whether this path is a step of the log flow.
 *
 * Exported because `ui/TabBar` needs the same answer for D-80 — _"the tab
 * beneath stays selected"_ — and a second copy of this list is a rival
 * truth, not a duplicate: the two would drift the first time the flow gains
 * a step and nothing would say so.
 *
 * The bar needs it because two of the four steps live *under* `/feed`, so
 * the tab that owns a path and the tab the runner came from are different
 * questions. Without this, attaching a kit lights Feed however the runner
 * got there.
 */
export function isLogFlowPath(pathname: string): boolean {
  return isAnyMatch(LOG_FLOW_PATHS, pathname);
}

/**
The four tabs. `+ Add` is a launcher and owns no seat (D-80).
*/
const TABS = ["/feed", "/closet", "/call", "/feed/me"] as const;

/**
 * Every edge this app can produce, at 390. **First match wins**, so the
 * specific rows come before the general ones.
 *
 * NAV's 620 and 1040 columns are `swap`/`panel` against the Desktop
 * Contract's panes and panels, which do not exist yet — task 115 creates
 * those layouts and inherits those columns. `panel` has no router-level
 * instance at 390 either: its two phone rows are *Garment detail → Retire
 * / delete confirm*, which NAV itself marks "not yet built", and *Anywhere
 * → Report / block*, which is already `ReportSheet` — and `panel` is
 * defined as "same physics as Sheet / drawer", so that row is built, just
 * not by the router.
 */
const NAV: readonly Edge[] = [
  // NAV: "Sign in ↔ Sign up" — "Siblings, no hierarchy — neither is
  // 'forward'."
  { from: "/auth/login", to: "/auth/signup", type: "swap" },
  { from: "/auth/signup", to: "/auth/login", type: "swap" },

  // NAV: "First load (/) → Sign in", "Sign out → Sign in". First paint and
  // a session ending; stillness either way.
  { from: "/", to: "/auth/login", type: "cut" },

  // NAV: "S1 prompt → Verdict (A3)". A push although A3 is a flow step,
  // because this is the contract ruling on the edge rather than on the
  // screen: a notification takes you *to* the verdict, it does not resume a
  // flow you were in. Above the flow rows for that reason.
  {
    from: ["/notifications", "/feed/entry/$entryId"],
    to: "/feed/verdict/$entryId",
    type: "push",
  },

  // NAV: "+ Add (bar launcher) → Log a run (A1…Q)" — note, "Steps inside:
  // Log flow step". So the router does nothing between steps and
  // `ui/FlowStep` owns the move; the two would otherwise animate the same
  // navigation twice.
  { from: LOG_FLOW_PATHS, to: LOG_FLOW_PATHS, type: "cut" },

  // NAV: "Log flow end (P3) → where you were" — "The drop half of rise."
  //
  // **Typed by analogy, and flagged.** NAV's row says the flow drops back
  // to where you were; this app lands on the thing the flow just created
  // (the entry, or the run). One rule for the whole class rather than a
  // row per destination: the flow layer drops away, and what is revealed
  // is the result. See docs/designs/117-navigation-types.md, question 1.
  { from: LOG_FLOW_PATHS, to: "*", type: "rise", reversed: true },

  // NAV: "+ Add (bar launcher) → Log a run" and "Closet C → Add garment
  // (F)" — "Same rise as Log a run — both are 'put something in the
  // closet'." A flow is a task laid on top of where you were.
  { from: "*", to: [...LOG_FLOW_PATHS, "/closet/new"], type: "rise" },

  // NAV: "Tab bar → Feed / Closet / Call / You" — "Indicator slides. Content
  // cuts." The tab bar is a destination, not a journey.
  { from: "*", to: TABS, type: "cut" },

  // NAV: "Strava OAuth return → T2" — "A document load from another origin.
  // There is no outgoing screen; first-paint rules apply." Nothing to
  // build; the row exists so nobody later types it as a push.
  { from: "*", to: "/runs/strava-callback", type: "cut" },

  // Root is a redirect shim, not a screen: onboarding's last step links to
  // it ("Take me to the app") and it sends the runner on. Typed `cut` by
  // analogy to the first-paint rows, because the move that matters belongs
  // to the screen it redirects to — animating the shim would play one move
  // over another. Not a NAV row; added under the header's ownership rule.
  { from: "*", to: "/", type: "cut" },

  // The pushes. Forward comes from the trailing edge, and back reverses it.
  // NAV, in order: "Closet C → Garment detail", "Garment detail → Edit
  // garment", "Feed X / Profile → Post detail", "Feed / Post → Someone's
  // profile", "Feed → Find runners", "Runs list → Run detail", "Import
  // status (T2/T3) → Run detail", "Bell → Notifications", "You G → Settings
  // index → detail", "Settings / Runs list / Onboarding → Strava (T1–T3)",
  // "Settings → Re-calibrate", "Onboarding O1 → O6".
  {
    from: "*",
    to: [
      "/closet/$itemId",
      "/closet/edit/$itemId",
      "/feed/entry/$entryId",
      "/feed/u/$userId",
      "/feed/search",
      "/runs",
      "/runs/$runId",
      "/runs/import/$importId",
      "/runs/strava",
      "/notifications",
      "/onboarding/name",
      "/onboarding/calibrate",
      "/onboarding/taplist",
      "/onboarding/settings",
      "/onboarding/done",
    ],
    type: "push",
  },
];

/**
`/closet/$itemId` matches `/closet/abc`; `*` matches anything.
*/
function isMatch(pattern: string, pathname: string): boolean {
  if (pattern === "*") return true;
  const wanted = pattern.split("/");
  const got = pathname.split("/");
  if (wanted.length !== got.length) return false;
  return wanted.every(
    (segment, index) =>
      // A `$`-prefixed segment is a route param and matches any one
      // segment — but not an empty one, or `/closet/` would read as a
      // garment whose id is the empty string.
      (segment.startsWith("$") && got[index] !== "") || segment === got[index],
  );
}

function isAnyMatch(
  patterns: string | readonly string[],
  pathname: string,
): boolean {
  return typeof patterns === "string"
    ? isMatch(patterns, pathname)
    : patterns.some((pattern) => isMatch(pattern, pathname));
}

/**
 * The view-transition type names this navigation activates, or `false` for
 * no transition at all.
 *
 * `false` is not an optimisation — it is how `cut` is spelled. TanStack
 * reads it and calls the update directly, so the next frame is the new
 * screen and the browser never takes a snapshot. A `cut` written as a 0ms
 * transition would still pay for two snapshots of the whole viewport.
 *
 * **A back navigation is looked up as the edge it is undoing**, which is
 * the one thing here that is not obvious and the one thing a test caught.
 * The table is written forwards, so resolving `(/closet/g1 → /closet)` as
 * written finds the *tab* row and answers `cut` — the runner would leave a
 * garment with no move at all. Swapping the pair first asks the question
 * the doctrine asks: "Back leaves the way it came", so what plays is the
 * edge that brought them, reversed.
 *
 * `reversed` is then an exclusive-or of two independent facts: the row may
 * itself describe a reverse move (the flow's exit is a `rise` that drops),
 * and the runner may be travelling backwards along it. Both true is a
 * forward move again — pressing back out of a post detail and into the
 * verdict that made it rises the flow back up.
 *
 * An edge no row claims is `cut`, and that is the safe answer rather than a
 * guess: stillness is never wrong-looking, and the doctrine's position on
 * unearned motion is that it is tax. A new edge reaching this default is a
 * row somebody owes the table, which `test/lib/nav-types.test.ts` fails on
 * by name so it cannot go unnoticed.
 */
export function viewTransitionTypes(
  from: string | undefined,
  to: string,
  isBack: boolean,
  // Mutable, because that is the shape TanStack's `ViewTransitionOptions`
  // declares and it hands the array straight to `startViewTransition`.
  //
  // `undefined` rather than TanStack's `false` for a cut: "no transition"
  // is a fact about the edge, and `false` is how one framework spells it.
  // The spelling is applied once, at the boundary below.
): string[] | undefined {
  // No outgoing screen at all: a first paint or a deep link. NAV types both
  // `cut` — "There is no 'from'. Arrive, then the screen's own reveal (if
  // any) runs." Same screen, new search params or hash: nothing moved.
  if (from === undefined || from === to) return undefined;

  const [start, end] = isBack ? [to, from] : [from, to];
  const row = NAV.find(
    (edge) => isAnyMatch(edge.from, start) && isAnyMatch(edge.to, end),
  );
  if (row === undefined || row.type === "cut") return undefined;

  return (row.reversed ?? false) === isBack
    ? [`nav-${row.type}`]
    : [`nav-${row.type}`, "nav-back"];
}

/**
 * One end of a navigation, as much of it as the decision needs.
 *
 * Structural rather than TanStack's `ParsedLocation`, so `lib/` stays
 * dependency-free and a test can build one by hand. `__TSR_index` is the
 * history index the router keeps on every entry; it is how "is this a back
 * navigation" is *read* rather than inferred from the table.
 */
interface NavLocation {
  readonly pathname: string;
  readonly state: { readonly __TSR_index: number };
}

/**
 * The router's entry point: a location change in, view-transition types out.
 *
 * This exists so `src/router.tsx` holds a reference and nothing else. That
 * file cannot be imported by any test — `routeTree.gen` pulls every route,
 * and a route pulls server functions — so a decision living there is a
 * decision no test and no mutant can reach. Here it is both.
 */
export function viewTransitionTypesFor({
  fromLocation,
  toLocation,
}: {
  readonly fromLocation?: NavLocation | undefined;
  readonly toLocation: NavLocation;
}): string[] | false {
  return (
    viewTransitionTypes(
      fromLocation?.pathname,
      toLocation.pathname,
      // No previous entry is a first paint, which is a cut either way — so
      // the fallback only has to avoid claiming the arrival went backwards.
      // `0` would: it is a real index, and the first navigation of a
      // session would read as a step back out of it.
      toLocation.state.__TSR_index <
        (fromLocation?.state.__TSR_index ?? -Infinity),
    ) ?? false
  );
}
