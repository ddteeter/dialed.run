# Design: 113 the design system port (Part A), plus §AG and §AH (Part B)

## Problem

Four lanes styled screens by measuring artboards, because no value contract
existed until round 10. The result is a rival scale: 93 arbitrary-value
utilities, 17 sites bypassing `Mono`, 10 letter-spacings. Part A makes
`design/tokens.js` + `Theme.dc.html` T1 the only source of values, enforced
by the framework rather than by review. Part B builds §AG (composition on
garment detail) and §AH (colour collection).

## Approach

Everything lands in `src/styles.css`'s existing `@theme inline` block, plus
the raw T1 hexes in `src/ui/tokens.css`. No parallel system, no new layer.

- **Type.** Seven `--text-<step>` triples (size + `--line-height` +
  `--letter-spacing`) and four `--text-mono-<step>`. One utility carries all
  three, so tokens.js law 1 — _tracking is a function of size_ — becomes
  unexpressible-otherwise instead of review-enforced.
- **`Mono` takes a `step`** (`xs|sm|md|lg`), default `sm` (11px/0.06em) —
  what 12 of the 17 bypasses and every current call site want. The step map
  carries `uppercase` for `xs`/`sm`; Tailwind's triple has no transform slot.
- **Colour.** All 15 T1 roles as `--color-*` over raw hexes in
  `tokens.css`; the five brand tokens stay as the palette beneath. Dark is
  111 — light column only, but the roles are named now.
- **Spacing needs no token**: Tailwind's `--spacing` is already tokens.js's
  4px. Radius, breakpoints and measures become `--radius-*`,
  `--breakpoint-{wide,desk}`, `--container-{panel,column,page}`.
  `Page.tsx`'s `max-w-xl`/`max-w-sm` become `max-w-column`/`max-w-panel` —
  620/390, the token over 576/384.
- **Tailwind's default `--text-*`/`--radius-*` namespaces are cleared.** See
  the open question; this is what sets the lane's size.

Part B follows Part A's _merge_, not its commit. §AG is display-only on
garment detail. §AH adds a nullable enum + hex named `hi_viz`, so the safety
flag cannot collide with the existing moderation `visibility` column.

## Contract touches

- Schema: **Part A none.** Part B additive + nullable, migration
  `add_garment_structured_color`, numbered past main and open PRs;
  `garmentBase` gains two optional fields — other lanes read it.
- New routes: none in Part A. New bindings/queues/crons: **none.**
- Screens: §AG, §AH (F, garment detail, shade sheet). Part A changes every
  screen's values and no screen's composition. Design deltas:
  `Marks.tsx`'s `rounded-[2px]`; §AH's VISIBILITY label vs our moderation
  column; the "WRONG? ›" link.

## Test plan

- `test/ui/tokens.test.ts` (unit) — the pin test, modelled on
  `icons.test.tsx`: parse `design/tokens.js?raw`, assert the parse found
  7/4/9/6/2/3 entries _before_ asserting values, then match each against the
  `@theme` block read from `src/styles.css?raw`.
- `test/ui/mono.dom.test.tsx` (jsdom) — each step's class triple; `xs`/`sm`
  uppercase and `md`/`lg` not; default `sm`.
- The 66 existing `toHaveClass` assertions across 13 files move to the token
  spelling. The rules they encode — mono is the tell a value was measured,
  1px→2px ink marks a field error — are re-asserted, never dropped.
- Lint rule proposed in the PR body, not landed (forbidden zone).

## Open questions

1. **How far does "collapse the 93" reach?** (Proceeding on: all the way.)
   Tailwind's default scale is a second rival scale and no done criterion
   names it. On `main`: `text-sm` (14px) ×86 and `text-base` (16px) ×9,
   which COLLAPSE sends to `TYPE.body`/`small`; `text-3xl`/`4xl` ×5 →
   `display`; `rounded-md` (6px) ×39, a radius no token has; and 149
   opacity colours against T1's _"full strength, never opacity"_. Stopping
   at the packet's letter satisfies "zero arbitrary values" while 86
   elements still render at a size no token names — so the default
   namespaces are cleared and `text-sm` stops existing, rather than being
   blacklisted in a rule a later lane can forget. Cost, honestly: ~390
   sites where pixels move plus ~230 rename-only, against 93. **If that is
   more reflow than you want in one PR, say so now** — the alternative is a
   second adoption pass, which is the "doing it twice" req 4 warns against.
2. **§AG's "WRONG? ›" link** — owner, 2026-09-19: omit until task 110
   exists. `docs/deferred.md` carries it; §AG ships display-only.
3. **§AH's hi-viz attribute** — owner, 2026-09-19: `hi_viz`. The artboard
   still says VISIBILITY; raised in `docs/design-deltas.md`.
