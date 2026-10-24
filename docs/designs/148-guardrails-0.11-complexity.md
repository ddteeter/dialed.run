# Design: 148 guardrails-core 0.11 + complexity paydown

## Problem

guardrails-core is pinned at 0.9.0. 0.11.0 adds a commit-rung `complexity`
analyzer (`fallow health --complexity`, changed files only, cyclomatic > 20
or cognitive > 15 blocks; CRAP excluded) and turns it on wherever fallow is
declared — which it is here. It also fixes `ship --body-file` pushing with
no PR (#194). Nine `src/` functions are over the limits today; any commit
touching their files would block. Owner's call (2026-10-22): upgrade and pay
all nine down in one PR before it lands.

## How fallow scores (measured, fallow 3.23.0)

- Cognitive includes two React terms: **+1 per hook call** and
  **+(destructured props − 4)** for PascalCase components. Most of the
  overage is hooks, not branching.
- An inner arrow/function is scored on its own, not added to its parent.
- Limits are strict `>`: 15 cognitive / 20 cyclomatic pass.
- So the levers are: fold hook groups into one custom hook; move
  ternary-heavy markup into ≤4-prop sub-components; pull loops and `??`
  chains into pure helpers.

## Rules for every step

1. **Extract within the same file.** Stryker grants are keyed
   `path|kind|directive text`; a same-file move with byte-identical
   directives keeps every key. A new file would re-key grants (owner call).
2. **No new `useCallback`/`useMemo`** — a new empty dep array is a new
   equivalent mutant needing a grant. Move existing ones with their
   directives.
3. **Don't change GarmentForm's or ParsedCard's prop signatures** — each
   carries a granted `fallow-ignore` clone suppression paired with
   KitPicker/Feed.
4. Logic moves verbatim; behaviour is observed by the existing tests
   through the public parent, so no test should need to change. If one
   does, that's a finding to report, not to paper over.
5. Done for a step =
   `npx fallow health --complexity --format json --quiet` shows the
   function gone from `src/` non-CRAP findings, the commit gate passes
   (complexity + dupes), and
   `npx stryker run --mutate "<touched files>"` is 100%.

## Steps

0. **Branch** off fresh `main`.
1. **Bump** `package.json` to the v0.11.0 tarball, `npm install`, run
   `guardrails-core init --plan`. Review every `update`/`drift` line on
   OWNED files (`.githooks/pre-commit`, `.github/workflows/guardrails.yml`,
   fixer agents, `docs/guardrails/*.md`, skills) — forbidden zones, so the
   diff goes in the PR for owner review, `--force` only on files we never
   edited. Add `"complexity": "required"` to `guardrails.config.json`
   explicitly (a missing fallow then blocks rather than skips). Done:
   `npm run verify` clean; a staged no-op edit to `GarmentForm.tsx` is
   blocked by `fallow/high-complexity` (proves the gate is live), then
   reverted.
2. **emailContent** (cyc 29) — replace the 20-case switch with a mapped-type
   table `{ [K in EmailKind]: (t: TemplateOf[K], links) => Body }`
   (correlated-union, no casts); keys derive from `EmailKind`, so exhaustive
   by compile, same as `PREFERENCE_OF`. Tests: `test/email/render.test.ts`.
3. **DeskAccess** (17) — split `CodesSection` (+ `useCodeHold`) and
   `RequestsSection` along the existing `<section>`s; status region stays
   in the parent. Tests: `test/account/access-pages.dom.test.tsx`.
4. **VerdictForm** (20) — `chosenFlagsOf`, `chipHistory` helpers;
   `ShareToggle` component. Tests: `verdict-form.dom.test.tsx`.
5. **ParsedCard** (19) — `LooksRightAction` (owns navigate + the
   mid-fetch-press effect), `RailConditions`, `noWeatherFailure`. Tests:
   `upload-form.dom.test.tsx`.
6. **useFormSubmit** (16) — `useRefusalAnswers` (also used by
   `use-control-action.ts`, which repeats the same two hooks) and
   `useFieldErrors`. Done also requires the full `src/ui/**/*.tsx` +
   `src/lib` mutation scopes, since this is the shared primitive.
7. **AttachKit** (23) — `useHeldPhoto`, `useSuggestion`, `KitChooser`,
   `AttachHeader`. "Leave it in the queue" link stays in this file
   (`targets-and-focus.test.ts` pins it).
8. **BlurBody** (25) — `useBlurredPhoto` (decode/detect/paint effects,
   moved verbatim incl. the restart-clearing notes and the `attempt = {}`
   retry), `useAnnounced`, `blurSentence`, `BlurSurface`. Highest
   behaviour risk. Tests: `photo-blur.dom.test.tsx`.
9. **GarmentDetail** (29) — `usePhotoActions`, `useGarmentLifecycle`,
   `GarmentPhoto`, `CompositionSection`, `ConfirmSheets`.
10. **GarmentForm** (41) — `useGarmentPhoto` (held/removed/refused state,
    `photoInFlight` guard, `finishWithPhoto`), `AttributeFields` with
    `ExactShade`, `EstimatedRange`, `IdentityFields`. Target ~13. Shaped
    after step 9 so its photo hook and GarmentDetail's don't form a clone
    group.
11. **Close out** — `npm run verify && npm test && npm run build`, full
    `npm run mutate` in the background, `docs/pr-self-review.md`, PR.
    No demo video: no user-visible change. CLAUDE.md gains a short note on
    the complexity gate (hooks and props count) next to the dupes section.

One commit per step; each step is independently revertible.

## Contract touches

- Schema: **none**. Bindings/queues/crons: **none**. Routes: **none**
  (unless the optional GarmentDetail `photo={{…}}` prop grouping is taken —
  not planned).
- Human-managed files touched: `package.json` dep URL,
  `guardrails.config.json` (`complexity` key), and whatever `init --plan`
  updates in OWNED files — all approved by this plan, listed in the PR.

## Open questions

- Steps 3–10 edit components in several lanes' modules (account, feed,
  runs, safety, closet). Root-session refactor, no lane active on them as
  far as I know — say if one is.
