# Design: 250 safety into sub-modules

> Wave 16, lane D (16d). Refs #796 step 5. The tree is design 240's,
> §"The tree" › `safety`, approved by the owner on 2026-11-18; this doc
> says how the move lands, not what the tree is.

## Problem

`safety` is 86 files in one folder behind a 224-name barrel, of which only
96 names are imported by another module. Design 240 splits it into nine
sub-modules, each behind its own `index.ts`. This lane moves the files.
Nothing a runner sees changes.

## Approach

Re-simulated on main at `b39415cc` (240 measured `418583f9`): every
safety file is placed by 240's table, and the service imports between the
nine units still form no cycle:

```
limits, notices -> rules
review    -> rules, limits, notices
screening -> rules, limits, notices, review
reports   -> rules, limits, notices, review, screening
takedowns -> rules, limits, notices, review, reports
runners   -> rules, notices
blur      -> (nothing)
```

1. **`git mv` each file to its unit**, components to the unit's
   `components/` (`NoticeBand` to `notices/components/`, and so on); the
   shared ones (`DeskForm`, `DueClock`, `StatutoryLine`, `ElsewhereHelp`,
   `short-id`, `use-settled`, `use-focus-when`, `counted`) stay in
   `safety/components/`. `classifier/` goes under `screening/`; `blur/`
   becomes the `blur` sub-module with `PhotoBlur` in its `components/`.
2. **Each door exports what crosses it, and nothing else**: the names
   another unit's service code imports, and the names the parent's
   `index.ts` re-exports. Widths measured from today's imports: rules 43,
   review 23, limits 21, screening 14, takedowns 14, notices 8, reports 6,
   runners 5, blur 0 plus what the parent needs. All under the budget of
   45, so no door needs a pin.
3. **Files beside the parent's `index.ts` import files, not doors.**
   `functions.ts` and `inputs.ts` are not held by
   `sub-modules-meet-at-the-door`. Through the doors, `rules` would be 50
   names, over budget; and `inputs.ts` is imported by components, so it
   must reach `rules/contracts.ts` directly, not a door that may reach
   `env`.
4. **`safety/index.ts` drops to the 96 names other modules import**,
   re-exported from the doors, and the components it exports today from
   the component files (a door never re-exports a component, 240 rule 5).
   Tests that used one of the 128 dropped names import the door or the
   file. No importer outside `safety` changes: today nothing in another
   module's `src` imports past `safety/index.ts` (measured).
5. **Shared files**, per 240 §"Order of the moves": `stryker.conf.json`'s
   four safety `.ts` entries become five entries of sub-module globs, as
   lane A grouped `ops`': the parent (`inputs.ts`, `index.ts`,
   `components/**/*.ts`); rules, limits and notices; screening; blur and
   review; reports, takedowns and runners; `targets-and-focus`' three safety component paths;
   `test/architecture/system-account` and `one-link-rule`'s safety paths;
   routes' component imports; `npm run modules:pin` (safety's `doorWidth`
   224 to 96, `files` 86 to the parent's 11, `fanOut` unchanged at 8);
   `npm run diagrams:generate`.

## Contract touches

- Schema changes: **none**. Routes: none new; 18 route files change an
  import path. Bindings/queues/crons: **none**. Screens: none.
- **Forbidden zone, needs the owner's grant:** `guardrails.config.json`
  keys six `fallow-ignore` grants by path (`blocks.ts`,
  `copyright-holds.ts`, `duplicates.ts`, `quarantine.ts`, `review.ts`,
  `desk-kit.ts`). Each file moves, so each key needs its new path, text
  and reason unchanged. Granted one-time by the owner, 2026-11-19
  (recorded on #796).
- Comments outside the lane that cite a moved path (`src/env/env.d.ts`, `src/ui/photo-step.ts`,
  `src/lib/contracts/*`, `vitest.config.ts`): asked of the coordinator.

## Test plan

No new behaviour, so no new test. What proves the move:

- `npm test` in full (the architecture tests are default-deny), including
  `module-shape.node.test.ts` at the lowered pins and
  `mutation-config.test.ts` (every module file in exactly one entry).
- dependency-cruiser in the commit gate: `sub-modules-meet-at-the-door`
  and `no-circular` hold the order above.
- `npm run build` (the client-bundle check: no component reaches a door).
- `npm run e2e:ci`, both legs. Mutation: renamed files are not mutated at
  push; CI's safety shards run cold once (two to three hours), expected.

## Issues

- Refs #796 (stays open for step E).
- Opens: none expected.

## Open questions

None open. The six grant re-keys were granted (owner, 2026-11-19).
