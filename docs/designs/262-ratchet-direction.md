# Design: 262 the ratchet's direction, parent doors and dispatch

> Wave 19 lane A1, #1043. Design 261 §A row A1, rulings 4, 6, 10 and 11.

## Problem

The modules already have a direction in their service code (design 260
finding 2), but nothing states it, and the side effect that holds it,
`no-circular` on files, weakens as importers take narrower doors. A split
module's parent door can grow unseen under the door budget (design 258),
and the pins file cannot tell a ceiling from a debt. This lane adds the
three checks that hold all three, pinned at today's numbers, so B and C
move under them.

## Approach

All in `scripts/modules/`, read by `test/architecture/module-shape.node.test.ts`.

- **(a) The direction**, a fifth kind, `direction`, with one unit,
  `modules`, and budget 0. New `scripts/modules/direction.ts`: each file
  under `src/modules` maps to its module, or to its floor unit when it is
  in one of `FLOOR` (`ops/outbox`, `ops/sentry`, `safety/rules`). Files in
  a `functions.ts` or in a unit of `COMPOSERS` (`account/purge`,
  `dispatch`) are left out. Components and type imports count. The number
  is the fewest file-to-file imports (dependency-cruiser's edges, as the
  ratchet already reads them) to cut so that no unit reaches itself: the
  groups of units that all reach each other, each ordered by an exact
  search over its subsets. A list that names a unit no longer there
  throws. **Reads 3** (4 with nothing apart, as design 260 scored):
  `feed/consensus/components/ConditionsTab.tsx` → `onboarding`
  (B2), `products/corrections.ts` → `safety` (B3) and
  `runs/components/VerdictBacklog.tsx` → `feed` (B2). Pinned at 3.
  `npm run modules:pin -- --print` names the imports to cut.
- **(b) Parent doors**, a sixth kind, `parentDoor`, budget 0: the names on
  `index.ts` of each module that holds a sub-module. Ruling 11 says "a
  split module", so all seven are pinned, not only the two 261's table
  names: `account` 35, `auth` 19, `feed` 16, `ops` 24, `runs` 16,
  `safety` 95, `weather` 23. When a module is first split, `modules:pin`
  may add its pin (the one kind where it may), and after that only lower
  it.
- **(c) Fan-out** no longer measures `dispatch` (its pin of 11 goes). The
  pins file gains `reasons`, by kind and unit; `account`'s and `feed`'s
  fan-out pins get one each. A reason whose pin is gone fails until
  `modules:pin`, which drops it, runs. `safety`'s fan-out pin stays a debt
  with no reason (B3 ends it).
- **The diagram.** Unchanged. `structure.generated.c4` already draws every
  sub-module, the floor units included, as its own element, read by the
  same `owningUnit`, and `dispatch` as its own module; the `modules` view
  already leaves out `dispatch` and the arrows into `ops` and `safety`.
  Drawing the floor units apart in that view would put back the arrows it
  leaves out to stay readable. One difference stays and is written in
  `docs/architecture.md`: the view's `imports` arrows leave out
  components, which the direction counts.
- **Docs.** D-207 in `docs/decisions.md`. `docs/architecture.md` §Module
  dependency graph: the direction, and ruling 6's paragraph (`safety`
  stays under the content it moderates; its status columns on other areas'
  rows are its own, A2's owner map lists them). CLAUDE.md §Architecture
  rules: one line for the direction and the floor, pointing at
  `direction.ts` for the lists.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens implemented: none

## Test plan

- `test/scripts/module-direction.test.ts` (vitest, worker project, pure):
  a two-module cycle reads its smaller side; wiring and composers are left
  out; a floor unit counts apart; a component and a type import count; a
  three-cycle; two separate groups add up; a stale `FLOOR` or `COMPOSERS`
  name throws; the cut names its imports.
- `test/scripts/module-shape.test.ts`: `parentDoor` measured only for
  split modules; `dispatch` has no fan-out; reasons kept, dropped and
  refused; `modules:pin` adds a `parentDoor` pin and no other.
- `test/architecture/module-shape.node.test.ts`: unchanged; the new pins
  are in `module-shape.json`.

## Issues

- Closes: #1043
- Opens: #1056, ruling 6's watch issue (`kind:watch`).

## Open questions

None for the owner. Proceeding on: all seven split modules' parent doors
are pinned (above); the count is of dependency-cruiser's file-to-file
edges, which matched design 260's statement count today.
