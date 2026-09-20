# Design: 117 Navigation types (design round 12)

## Problem

The doctrine covered what happens _on_ a screen; task 114 built those nine
surfaces. Between screens there is nothing, which is the layer that makes
the app feel flat. Round 12 supplies it: five types, 26 typed edges, and one
law — every navigation has a direction, and the direction is the transition.

## Approach

**One resolver, wired once.** The obvious approach — type each of the 60
`Link`/`navigate` sites — is wrong twice over: it spreads the NAV table
across every lane, and round 12 says the router reads the type _from the
edge_. The packet flagged `defaultViewTransition` as static; it is not, in
the way that matters. `ViewTransitionOptions["types"]` accepts a **function**
of `{ fromLocation, toLocation, … }`, and returning `false` skips the
transition entirely — which is exactly `cut`. Measured in
`router-core/dist/esm/router.js`, not assumed.

So: `src/lib/nav-types.ts` holds the NAV table as route patterns and the
whole decision; `src/router.tsx` holds a reference and nothing else. That
split is not tidiness — `router.tsx` cannot be imported by any test, because
`routeTree.gen` pulls every route and a route pulls server functions, so a
decision left there is one no test and no mutant can reach. `router.tsx` is
unowned and shared; flagged in the PR, no other lane's files touched.

Forward vs back is read, not inferred: `ParsedHistoryState.__TSR_index`
carries a monotonic history index, so `push`'s "Back reverses both" is a
fact about the navigation rather than a guess from the table. **And a back
navigation is looked up as the edge it undoes** — the table is written
forwards, so resolving `/closet/g1 → /closet` as written finds the _tab_ row
and answers `cut`. A test caught that; without the swap, leaving a garment
has no move at all.

```
Link/navigate ─► router.startViewTransition
                   └─ types: viewTransitionTypesFor(info) ─► ["nav-push"] | false
                        └─ document.startViewTransition({types})
                             └─ :active-view-transition-type(nav-push) in motion.css
```

**Scope is the 390 column.** NAV's 620/1040 columns are `swap`/`panel`
against Desktop Contract panes that do not exist; task 115 creates those
layouts and inherits them. And `panel` has no router-level instance at 390
either: its two phone rows are _Retire / delete confirm_ (marked not yet
built — the closet lane's screen) and _Report / block_, which is already
`ReportSheet`, i.e. the Sheet physics `panel` says it is. The phone column
builds `push`, `rise`, `swap`, `cut`.

**Named elements: one, where the doctrine permits two.** The persistent tab
bar, so `rise`'s "the bar stays put" is true. The doctrine also permits "the
bracket frame", and that permission goes unused deliberately: `ui/Bracketed`
is an inline text device, not a frame — `EntryDetail` renders seven — and a
duplicate `view-transition-name` does not degrade, it **aborts the whole
transition**. Fewer names than the doctrine allows is always safe; more is
the thing round 12's new NEVER entry forbids.

**Two pieces of 114 close here.**

1. `FlowStep` keeps the slide for steps _inside_ the flow, but the entry
   from the bar is a `rise` and A1 currently plays the slide. The arrival
   move is deleted from `FlowStep`, not rebuilt — the router owns it.
2. D-80's second half. `TabBar` learns the last tab the runner was actually
   on, module state with an SSR answer in `FlowStep`'s `flow.lastStep`
   shape, so the tab beneath stays selected while the flow is up. Today
   `/feed/attach/$runId` lights **Feed** mid-flow whatever you started from,
   which is the same bug wearing a different hat.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: no new screens; every screen's _arrival_ changes. `motion.css`
  gains `--travel-frame` (TRAVEL.frame, 8px — already in the contract,
  not yet ported) and the `::view-transition-*` rules, which are plain CSS
  and not `@utility`: a pseudo-element is not a class Tailwind can know.
- `docs/design-deltas.md`: round 12 recorded as imported. No new open item —
  every move here comes from a contract, so nothing is an undesigned surface.

## Test plan

- `test/lib/nav-types.test.ts` (unit) — the resolver directly and hard: every
  NAV row's phone type, both directions, no `from` (first paint / deep link)
  → `cut`, and a pin against `NAV_TYPES` parsed out of `design/motion.js`.
  Plus the one that makes the ownership rule enforceable: it scans every
  `to="/…"` in `src/` and **fails by name** if a destination no row claims
  has appeared, because `cut` is both a real answer and the default and so
  cannot be told apart at the call.
- `test/ui/motion-css.dom.test.tsx` (unit, extended) — each type's rules
  resolve to the duration and easing `NAV_TYPES` names, `--travel-frame`
  matches `TRAVEL.frame`, and the reduced-motion path collapses **every**
  type to swap at instant with cut left alone and nothing at zero.
- `test/ui/motion-surfaces.dom.test.tsx` (unit, extended) — the remembered
  tab: held through all four flow steps, given back on the way out, not lit
  on `/onboarding/*`, and — through the pure `tabToLight` — not lit on a cold
  load of `/runs/new`. Plus `FlowStep`: no move entering, the slide between
  steps, back reversing, and the record cleared on leaving. The flow cases
  key the element on the step, because a route change unmounts and mounts in
  **one commit** and a detached `unmount()` then `render()` does not.
- Browser project — the accessible-name check after re-nesting anything a
  name is computed from (114's `Useful [ 1 ]` lesson).
- Existing demos re-recorded; navigation is not a feature, so no new spec.

## Open questions

1. **One edge is not in NAV and I am typing it by analogy**, which is the
   header's own instruction rather than a guess I am hiding. The flow ends
   `/feed/verdict/$entryId → /feed/entry/$entryId`, but row 3 describes the
   end as "→ where you were"; this app lands on the entry it just created.
   Typed `rise` (row 3's drop half, nearest row) rather than `push` (row
   11's post-detail arrival). The row goes in `NAV` in this PR. Veto to
   `push` if the arrival should read as going deeper rather than the flow
   dropping away.
2. **jsdom has no `startViewTransition`**, so nothing here asserts a
   transition _ran_. The tests assert what was decided — which type an edge
   resolves to, that the resolver is wired, what the CSS declares. The
   demo video is the only place the moves are observed.
