# Design: 112 The accessibility contract

## Problem

`design/Accessibility Contract.dc.html` is WCAG 2.2 AA plus what each lane has
to test before a PR is done. Its own framing is that the rules are _"already
half-stated across five files; this is the one place they all are"_ — so most
of the work is not new rules but the requirement to **meet and test** them,
and a handful we do not meet today.

## Approach

**Measure first, and prefer CSS to markup.** The audit is the deliverable as
much as the diff: three of the ten requirements turned out to be already met
and want pinning rather than building, and one of the three "already decided"
ones was not.

The two cross-cutting requirements land as CSS, which keeps the markup sweep
to class names and keeps the mutation ratchet honest — a plain
`className="…"` attribute is not mutated, a new const or ternary is.

- **Focus (5)** is one rule in a new `src/ui/focus.css`: `2px` solid,
  `offset 2px`, `outline-color: var(--ink)`. Because `--ink` is already the
  ground's text colour and already flips inside `[data-ground="ink"]`, "ink on
  paper, paper on ink" is derived rather than restated. `outline` follows the
  element's own `border-radius`, so "pill buttons get a pill outline,
  everything else square" is also by construction. Six `outline-none`
  bypasses are removed; `FormField`'s bordered box grows
  `has-[:focus-visible]:` so the ring marks the box rather than the borderless
  input inside it.
- **Hit areas (4)** are a `target` utility in the same file — `min-height`
  and `min-width` of `44px`, applied by class. Standalone targets only; a link
  inside a sentence takes WCAG 2.5.8's inline exception, which is queued to
  design as _the inline target_. Tab items are `44` tall _including the
  launcher_, which is a `<button>` since round 12 and so needs the padding on
  two element types.

**One live region per screen (7).** `FormStatus` stays the region and gains a
provider; `PhotoBlur`'s private `aria-live` paragraph stops being a second
one and writes W3's three sentences into the screen's own. No new words —
`blurSummary` already owns them.

**Three requirements were already met** and get tests that fail if they
regress rather than code: colour is never the only channel (1), opacity never
encodes meaning (2), and — measured across all 33 routes — exactly one `h1`
each (6). `CoverageMark`/`VerdictMark` stay `aria-hidden`: every one of the
four call sites prints the level or the verdict as a word beside the mark,
verified caller by caller, so a label would read _"partial, partial"_.

**The contrast pass (10) is a test over T1 itself**, enumerating every
role×ground pairing and asserting its floor. It is what found the two failures
below.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: no new screens, no composition change. `docs/design-deltas.md`
  gains three open-queue items — **the label grey**, **the unavailable
  control**, **the inline target** — all three sent to design in this PR.
- New dev dependency: `axe-core` + `jest-axe`, owner-approved 2026-09-17,
  landed in its own first commit so the push gate's stryker run does not
  mutate a markup sweep alongside a `package.json` change.

## Test plan

- `test/ui/focus.dom.test.tsx` (unit) — every primitive's focus ring after a
  `Tab`, on both grounds; the ring is never `outline: none`.
- `test/ui/targets.dom.test.tsx` (unit) — the `target` class on every
  standalone target, and the tab bar's five seats including the launcher. axe
  cannot see a hit area, so this is asserted explicitly.
- `test/ui/axe.dom.test.tsx` (unit) — `axe-core` over every `ui/` primitive
  and every module component that renders without a server function.
- `test/ui/contrast.dom.test.tsx` (unit) — every T1 role × every ground,
  against rule 02's floors, read from `src/ui/tokens.css` so a token edit
  cannot drift past it.
- `test/architecture/one-h1-per-route.test.ts` (unit) — walks each route's
  render graph the way `routes-stamp-hydration` does and requires exactly one
  heading source. Routes cannot be imported, so this is source text.
- `test/ui/marks.dom.test.tsx` (extended) — the position of the filled slot
  differs per verdict, so hue alone cannot carry it; and the four call sites
  print the word beside the `aria-hidden` mark.
- `test/ui/live-region.dom.test.tsx` (unit) — one `role="status"` per screen;
  `PhotoBlur`'s sentences arrive in the form's region and its paragraph is no
  longer live.
- `test/safety/photo-blur.dom.test.tsx`, `test/ui/layout.dom.test.tsx`,
  `test/ui/form.dom.test.tsx` (extended) — the `aria-disabled` swap on nine
  controls: still tabbable, press does nothing, no `disabled` attribute.
- Existing demos re-run unchanged. **No new demo**: nothing a user sees
  changes shape, and keyboard focus and screen-reader output do not record.

## Open questions

Three, all sent to design in this PR as design-delta items, all with the
lane's own recommendation attached, and none of them blocking:

1. **The label grey.** `--muted #7A7A70` is 3.90:1 on paper — T1's own note
   calls #7A7A70 decoration-only, yet it labels every field, every legend and
   every inactive tab, where the Tab bar row asks for **#6E6E64 (4.64:1)** and
   T1 has no row at that value. And `--dialed-text #009F8C` is 2.98:1 across
   nine meaning-carrying uses. Both are T1 values, so both are design's.
   Until answered the contrast test records them as the two known-failing
   pairs rather than passing over them.
2. **The unavailable control.** Rule 07 retires `disabled` and rule 02 retires
   the dimming that went with it, leaving nine controls with no drawn state.
   Recommending the Form Contract's existing answer (breathing-brackets
   pending label, no opacity) for the eight in-flight ones, and silence for
   `Attach N items`, which X3's keyboard list already allows.
3. **The inline target.** Reading rule 03 as standalone targets, per WCAG
   2.5.8, so no board reflows. Veto and twelve links get padding instead.
