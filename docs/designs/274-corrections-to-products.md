# Design: 274 the Desk's Corrections page moves to `products`

> Design 261 §B row B3 and ruling 9 (the full move); design 258 proposal 3. Issue #1073. Behaviour-neutral: no server function changes its
> behaviour, method or validator.

## Problem

The Desk's Corrections page shows and decides `products`' corrections,
but its component and its three server functions live in `safety`. That
is the one reason `safety` imports `products`, and it holds `safety`'s
fan-out at 8 against a budget of 7.

## Approach

- **The page.** `safety/review/components/DeskCorrections.tsx` moves to
  `products/components/DeskCorrections.tsx`. It reads `products`' result
  types from their own file, `correction-queue.ts`, not the door.
- **The server functions.** `deskCorrectionsQuery`, `applyCorrectionFn`
  and `declineCorrectionFn` move from `safety/functions.ts` to
  `products/functions.ts`. Each keeps its method, validator and handler
  word for word. The admin gate comes from `safety/rules`, the narrowest
  door (ruling 2). `products` already imports `safety`, so its fan-out
  does not change. Their rows in `test/architecture/verification-class.test.ts`
  move with them and stay `admin`. `src/routes/desk/corrections.tsx`
  changes only its imports.
- **The Desk form pieces.** A component may not import another module's
  component, so what both modules now need goes to `src/ui`:
  `DeskForm.tsx` (with `PickOne`, `RecordHead` and the rest of its
  exports), `QuietAction` (out of `RemovalDecision.tsx`, into
  `src/ui/DeskForm.tsx` beside the other Desk bar pieces), `counted.ts`
  and `short-id.ts`. `src/ui`'s door exports them, and `safety`'s
  importers follow. `feed/counted.ts` is a different function (it takes
  both forms) and stays.
- **The ratchet.** `safety`'s fan-out falls 8 → 7, so its pin leaves
  `test/architecture/module-shape.json`. `products`' door is unchanged
  (no name is added to it).
- **Mutation config.** No entry covers `src/modules/products/**/*.tsx`,
  and `test/architecture/mutation-config.test.ts` requires one. It joins
  the closet, account and email components' shard. `src/ui`'s globs
  already cover the moved pieces.
- **Tests** move with their subjects: `test/safety/desk-corrections.dom.test.tsx`
  to `test/products/`, and `counted` and `short-id`'s to `test/ui/`.
- **Left out**, as design 258 says: the Duplicates page.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**.
- Protected paths: `stryker.conf.json`, `test/architecture/module-shape.json`,
  `test/architecture/verification-class.test.ts`.

## Diagrams

`diagrams:generate` redraws the structure: the `safety → products` arrow
goes. Two stories cite `safety/functions.ts` (`publicPhotosStory` and the
removals stories), and are re-read.

## Test plan

No new behaviour, so no new tests. The moved tests keep passing at their
new paths. `module-shape.node.test.ts`, `mutation-config.test.ts`,
`verification-class.test.ts` and `server-functions-are-glue.test.ts`
prove the ratchet, the shard, the gate class and the glue.

## Issues

- Closes: #1073
- A2's table-write map (#1044), once it lands, lists the corrections
  writes under `products`. They were always in `products/correction-queue.ts`,
  and only the server function wiring moves here.

## Open questions

None.
