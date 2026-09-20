# Task 113 — The design system port, plus §AG and §AH (adoption lane 1 of 5)

## Goal

**Part A** — port `design/tokens.js` and `Theme.dc.html`'s T1 colour table
into the app, collapse the values that predate them, and make the result
enforceable.

**Part B** — build §AG (composition on garment detail) and §AH (colour
collection), the two v1 slices round 10/11 delivered.

**Do Part A first and completely.** They are folded into one lane (owner,
2026-09-18) because §AH edits `GarmentForm` and `garmentBase`, which Part A
already rewrites, and three separate passes over those files is the
contention this sequence exists to avoid. They are still two pieces of work:
**land Part A, verify it, then start Part B.** Part A's done criteria do not
mention colour and Part B's do not mention tokens.

One consequence to accept up front: this lane is no longer
"className-only". Part B adds a migration, new fields and new UI, so the
"no behaviour changes" rule below applies to **Part A only**.

This is the lane that fixes the drift the whole adoption sequence exists for:
**93 arbitrary Tailwind values, 17 sites bypassing the `Mono` primitive, 10
rival letter-spacings, and 5 invented font sizes** (10/11/13/15/17px) that no
token names.

## Why it is first

Every other adoption lane's numbers come from here. Motion's travel distances
are spacing steps; accessibility's focus outline, 44px targets and 8px gaps
are token values; desktop's breakpoints and measures are `BREAKPOINT` and
`MEASURE`. Doing any of them first means writing raw px and rewriting it
immediately.

## You own

- `src/ui/tokens.css`, `src/styles.css`, `src/ui/ink.css`
- `src/ui/*.tsx` — every primitive
- `src/modules/*/components/*.tsx` — className only in Part A. **No
  behaviour changes in Part A.**
- For Part B: `src/db/schema-core.ts` + a migration, `src/lib/contracts.ts`,
  `GarmentForm`, garment detail, and a new shade sheet.
- `eslint.config.js` is a forbidden zone — the lint rule below needs the
  owner. Write it, propose it, do not land it yourself.

## The mechanism: Tailwind v4 `@theme`, not a parallel system

`src/styles.css` already maps brand tokens into Tailwind's theme with
`@theme inline`. Extend that rather than inventing anything:

```css
@theme inline {
  --text-body: 15px;
  --text-body--line-height: 1.5;
  --text-body--letter-spacing: 0em;
  /* … one block per TYPE step and per MONO step … */
  --spacing-3: 12px;
  --radius-card: 12px;
  --breakpoint-wide: 720px;
  --breakpoint-desk: 1040px;
}
```

**This is the point of the lane, so do not miss it.** Tailwind v4 pairs
`--text-<name>--line-height` and `--text-<name>--letter-spacing` with the
size, so a single `text-body` utility applies all three. That makes
`tokens.js` law 1 — _"tracking is a function of size, not context"_ —
enforced by the framework instead of by review. It is also why `Mono`'s
hardcoded `tracking-[0.08em]` caused 17 bypasses: one primitive could only
ever carry one tracking, and the scale has four.

## Requirements

1. **The type scale.** Seven `TYPE` steps and four `MONO` steps from
   `design/tokens.js`, each as a `--text-*` triple. Mono steps carry their
   `transform` too (`xs`/`sm` are uppercase).
2. **`Mono` takes a step.** `<Mono step="sm">` rather than one hardcoded
   treatment, defaulting to the step the existing call sites actually want —
   check each of the 17, do not assume.
3. **Collapse the 93.** `tokens.js`'s `COLLAPSE` table says where each stray
   goes; it is authoritative and explicitly a correction, not a value to
   keep. Known specifics: `Wordmark.tsx`'s `text-[#8B8B93]` is a raw hex and
   becomes T1's `--muted`; `Marks.tsx`'s `rounded-[2px]` has no token
   (`RADIUS.tight` is 4) — raise it rather than inventing one.
4. **T1 colour, light values only.** All 15 semantic roles — `--ground`,
   `--panel`, `--ink`, `--muted`, `--quiet`, `--hairline`, `--hairline-2`,
   `--action`, `--failure`, `--cold-text`, `--dialed-text`, `--tint`,
   `--photo`, `--placeholder`, `--unread` — mapped through `@theme`.
   **The dark column is task 111 and out of scope**, but name the roles now:
   the renaming is the expensive half and doing it twice is worse. Today's
   five brand tokens stay as the raw palette T1's roles resolve to.
5. **Spacing, radius, breakpoints, measures** per `SPACE`, `RADIUS`,
   `BREAKPOINT`, `MEASURE`. Reconcile `Page.tsx`'s `max-w-xl`/`max-w-sm`
   against `MEASURE.column` (620) and `MEASURE.panel` (390) — they are close
   but not equal, and the token wins.
6. **A pin test, following `test/ui/icons.test.tsx` exactly.** `tokens.js` is
   untyped JS in a read-only archive, so it cannot be derived from — import
   it with `?raw`, parse it, and assert every ported step matches. That test
   is the thing that makes the next design round tell you what moved instead
   of letting it rot silently. CLAUDE.md §Derive-don't-mirror requires it.
7. **The lint rule**, written and proposed. `tokens.js` ships nine `LINT`
   entries, but they are CSS-declaration regexes (`font-size:\s*\d`) and our
   styling is Tailwind utilities in JSX — **the intent ports, the patterns do
   not.** What we need is a rule rejecting arbitrary-value utilities
   (`text-[…]`, `tracking-[…]`, `rounded-[…]`, `p-[…]`, `gap-[…]`,
   `min-w-[…]`) outside a narrow allowlist, plus raw hex anywhere. Model it
   on the existing rule that rejects new `requireUserId` copies.

## Part A out of scope

- The dark column (111), motion (114), accessibility (112), desktop (115).
- Any layout change. If a collapsed value visibly moves something, that is
  expected — a _reflow_ is fine, a _redesign_ is not.
- Landing the eslint rule yourself.

## Test expectations

- The pin test above, non-vacuous: assert the parse found the expected number
  of steps before asserting anything about them, the way the icons test
  asserts `declared.size > 70`.
- `src/ui/**/*.tsx` and `src/modules/**/*.tsx` are in the mutation ratchet at
  100% and must stay there. Stryker does not mutate a plain
  `className="…"` attribute, but it does mutate a class string held in a
  const — and this lane creates those. Expect real mutants.
- Existing component tests asserting `toHaveClass` on old values will fail by
  design. **Update them to the token, do not weaken them.** Where one asserted
  a documented rule (mono is the tell a value was measured; 1px→2px marks a
  field error), the rule still holds — only its spelling changes.

## Part A done criteria

- Zero arbitrary-value utilities outside the allowlist; zero raw hex outside
  `tokens.css`.
- The pin test passes and fails when a step is edited.
- The lint rule is written and in the PR for the owner to land.
- `npm run verify && npm test && npm run build` green; mutation score holds.
- **Demo video: yes.** Type, spacing and colour change on every screen. This
  is precisely the case CLAUDE.md names — a screen whose appearance changed
  behind unchanged behaviour is the demo worth watching.

---

# Part B — §AG and §AH

Read `design/Remaining Screens.dc.html` §AG and §AH before starting. What
follows is the shape and the traps, not a substitute for the artboards.

## §AG — composition on garment detail

- **Garment detail only.** Not the closet grid, not a filter, not the Call.
  Design's reason: _"the closet is for finding. Four-line compositions under
  every card make the grid a spec sheet and bury the range, which is the
  number that decides what you wear."_
- `fabric_parts` → labelled rows in the brand's order. `fabric_composition`
  → verbatim, one line. Both null → no block at all.
- **Values are the brand's text.** No normalising "elastane" to "spandex",
  no reordering by percentage, no summing to check it hits 100. A "merino"
  filter is post-v1 and needs normalised fibres — the parser round 5
  refused.
- Composition never touches the recommendation.

**Stop and ask before building the "WRONG? ›" link.** The artboard files it
into the Desk review queue, and **that queue does not exist**: task 110 is
unscheduled and there is no product-correction table in the schema. Lane
106's report flow is for content, not product facts. So either the link
waits for 110, or it needs a destination this lane would have to invent —
which is a product call, not yours.

## §AH — colour

**v1 is collection and display only.** The Call's tiebreak — the OKLCH
distance rule — is Epic 200 and is **not** in scope. Build the data and the
surfaces; leave the rule.

- **Thirteen locked names, two classes** (the rule keys off the class):
  Neutral — black, white, grey, navy, brown, beige. Colour — red, orange,
  yellow, green, blue, purple, pink. No "multi", no "other".
- **Chips are words, not swatches** — _"thirteen swatches is thirteen
  accents in one viewport."_ Do not render colour chips as colour.
- **F**: colour is the fifth attribute inside the already-collapsed group,
  so the happy-path tap count does not move. The existing free-text
  colourway ("Obsidian") stays as the row's caption, untouched.
- **Garment detail**: the name on the identity line, the way §AG carries
  composition. No swatch.
- **The shade sheet (level 2) is composed, not drawn** — sheet, photo, one
  field, two buttons, all existing `ui/` primitives. The sampler is a tap on
  the photo reading the pixel under the ring: no magnifier, no drag. No
  photo → no sampler, the field stands alone. **Level 2 is unreachable
  without level 1** — the sheet is opened from a chosen name.
- Enrichment may propose the _name_ as an editable claim (F2c). **It never
  proposes a hex.**

### Two traps, both found while scoping this

1. **`visibility` is already taken, and it means something else.** §AH's F
   attribute strip reads `WEIGHT · FABRIC · WIND · VISIBILITY · COLOUR`,
   where VISIBILITY is a garment property feeding the hi-viz exemption. But
   `wardrobe_items.visibility` **already exists** — `text("visibility")
.notNull().default("ok")`, sitting next to `retired`, and it is the
   moderation state. `closet/service.ts` writes `"ok"`. **Naming the new
   attribute `visibility` would overwrite a trust-and-safety field**, and
   nothing would fail loudly. Pick a different name (`hiViz`,
   `highVisibility`) and say so in the PR; raise the collision in
   design-deltas so the artboard's label and our column stop disagreeing.
2. **Hi-viz is not one of the thirteen.** It is _"invisible to the test —
   not Neutral, not Colour, not counted. It's safety because the runner said
   so, never because a hex is bright."_ So it is a separate flag, not a
   colour value, and the enum must not grow a fourteenth entry for it.

### Schema

Additive and nullable, so the protocol says proceed — but **name the
migration for what it does** and number it past whatever is on `main` and in
open PRs at the time:

```sh
npm run db:generate:core -- --name=add_garment_structured_color
```

Keep `color` (free text) as the colourway caption. Add the thirteen-name
enum and a nullable hex beside it. **Nothing is parsed and nothing is
backfilled** — mapping "Obsidian" to black is the parser round 5 rejected.

`garmentBase` in `lib/contracts.ts` gains two optional fields. That is
additive, and other lanes read the contract — say so in the PR.

## Part B done criteria

- §AG renders on garment detail and nowhere else; brand text untouched.
- §AH: enum + hex collected on F, name on garment detail, shade sheet
  composed from existing primitives, level 2 unreachable without level 1.
- The `visibility` collision avoided and raised.
- The "WRONG? ›" question answered by the owner, not assumed.
- **Demo video: yes** — adding a colour to a garment and reading a
  composition are both visible changes.
