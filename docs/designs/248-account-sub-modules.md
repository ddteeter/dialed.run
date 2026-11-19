# Design: 248 account sub-modules

## Problem

`account` is 60 files in one folder, and with `auth` it forms a two-module
import cycle (#796). Wave 16's lane B moves it into the seven sub-modules
that design 240 approved (§"The tree" › `account`) and cuts knot 4. It is a
move PR: paths and imports change, behaviour does not.

## Approach

The target is design 240's `account` table, file by file; this doc does not
restate it. Each sub-module gets an `index.ts` door, and its screens go in
its own `components/`. What stays beside the parent's `index.ts`:
`functions.ts`, `inputs.ts`, `route-decisions.ts`, `theme.ts`,
`theme-answer.ts`, `use-go-home.ts`, `use-saved-page.ts`, and the shared
`components/ActionCard.tsx`. `open-source-list.json` goes to `terms/` with
`licence-text.ts` (scripts/open-source-list.ts writes it).

How each kind of importer is rewritten:

- **Sub-module to sub-module: through the door.** For example `username.ts`
  imports `../terms`, and `purge.ts` imports `../access` and `../data`.
  Simulated over today's graph: the order is terms, verification, handles,
  access, data, export-build, purge. No door imports a later one.
- **Components, and the parent's client-side helpers, import files
  directly** (240 rule 5): a door may reach `env`.
- **`functions.ts` keeps file imports**, with the new paths. It is the
  parent's own file and the doc's rule binds sub-module files only.
- **`account/index.ts` re-exports the same names from the doors** (rule 4).
  It does not re-export `export-build` or `purge`.
- **`src/server.ts`** imports the doors: `account/purge` and
  `account/export-build` keep their specifier (the folder's `index.ts`
  answers it), and `answered-requests`, `handle-rescreen` and
  `export-sweep` become `account/access`, `account/handles` and
  `account/export-build`. Rebased onto lane A's rewrite of that block
  first. "Past the door" for `account` falls from 5 to 0.
- **Routes, tests and `scripts/open-source-list.ts`**: new file paths.
  Architecture tests that name account files (`targets-and-focus`,
  `system-account`, `weather-tables`, `daily-upkeep`) get the new paths.
- **Knot 4: `PasswordCheck` is declared in `account/verification`.**
  `auth/password-check.ts` and `auth/require-user.ts` import it from that
  door, and `auth/index.ts` stops exporting it (only `account` and one
  account test used it). That removes `account`'s one service import of
  `auth`. The only edit outside `account`, named in 240 as this lane's.
- **`.dependency-cruiser.cjs`, granted by the owner on 2026-11-19** (#796):
  `lib-browser-is-client-only` names `account/(export-build|purge)/` as
  whole folders and `account/data/export-queue.ts` by name.
- **`guardrails.config.json`, granted by the owner on 2026-11-19**: the
  three suppression grants keyed by `account/export.ts`, `invites.ts` and
  `purge.ts` are re-keyed to the new path. Path prefix only; comment,
  reason and count unchanged. `eslint.config.js` names no account path.
- Comments elsewhere that cite an old account path are updated in `lib/`
  and `ui/`; `db/schema-core.ts` (forbidden) and `ops/digest-email.ts`
  (lane A's) keep theirs, and an issue lists them.
- `npm run modules:pin` lowers `account`'s pins; diagrams regenerate after
  every rebase, and `npm run diagrams:stale` finds the stories to re-point.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden zone: `.dependency-cruiser.cjs` and `guardrails.config.json`,
  both granted above.
- Screens: none change.

## Test plan

- No new tests: every moved file keeps its tests, re-pointed. The full
  `npm test` (with `test/architecture/module-shape.node.test.ts` and
  `diagram-structure`) and both e2e legs show nothing changed.
- The dependency-cruiser edit: a planted `lib/browser` import in
  `account/purge/` and in `account/data/export-queue.ts` is refused, and
  one in `account/data/deletion.ts` passes. Removed after checking.
- `npm run build`: the client bundle check and the entry budget.

## Issues

- Refs #796.
- Opens: the stale path comments in `db/schema-core.ts` and
  `ops/digest-email.ts`.

## Open questions

None. Mutation: the push gate does not mutate renamed files, and CI's
`account` shards run cold once.
