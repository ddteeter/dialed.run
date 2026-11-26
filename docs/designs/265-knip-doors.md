# Design: 265 knip over the module doors

> Design 261 §A row A4, ruling 16. Issue #1046. Behaviour-neutral: no
> source file changes.

## Problem

Knip reports no unused export today because every top-level module door
and every `functions.ts` is an entry, and tests are entries, so a door
name that only a test imports, or that nothing imports, is never
reported. Ruling 16: knip runs in production mode over the doors, and a
door name no source file imports fails. The names that fail today are
pinned, and C1 to C4 remove them.

## Approach

**`knip.json`.** The app's real entries take knip's production marker
(`!`): `src/server.ts` (wrangler's `main`), `src/start.ts`,
`src/router.tsx` and `src/routes/**/*.tsx`. `src/**` in `project` takes
it too. `src/modules/*/index.ts` and `src/modules/*/functions.ts` leave
the entry list. The other entries stay as they are (unmarked, so
production mode ignores them).

Default mode, which the commit gate runs, still reports nothing with the
doors gone from the entries (measured at `740f4f85`). So the gate is
unchanged today, and from now on it also reports a door name that not
even a test imports.

**The check: `test/architecture/knip-doors.node.test.ts`**, a node test,
not a CI step. A CI step edits `.github/workflows/`, which is the owner's,
and buys nothing here: the test already runs in CI's test job and in
`npm test`, and takes about 4 s. It runs `knip --production --include
exports,nsExports,types,nsTypes --reporter json`, parses the report with
zod, and keeps the door files: every `index.ts` under `src/modules`
(sub-module doors too) and every `functions.ts`. The names reported on
each must equal its pinned list in `test/architecture/knip-doors.json`.

- A new name fails: delete it from the door, or import it where it is
  used. Never add it to the pin.
- A name that went away fails too, until it leaves the pin, so the pin
  only falls. The failure prints the lines to remove.
- Names, not counts, so a new dead name cannot replace a deleted one
  unseen.

Today: 75 exports and 52 types on 25 door files. The brief's "about 73"
counted exports only (design 261 measured at `96055f7c`). Ruling 16 says
"a door name", and a type is one, so both are pinned.
`safety/blur/index.ts` is reported as an unused file; it exports nothing
on purpose, so `files` is left out of `--include`.

**Upstream.** Yes, ask guardrails-core for a production-mode pass on its
knip analyzer, as #1007's question 2 already frames it: it would keep the
touched-files filter and give it to every repo on the scaffolding. A4
does not wait for it. A comment on #1007 records this lane's
recommendation; filing on the guardrails repo is the owner's call.

## Contract touches

- Schema changes: **none**. Routes: none. Bindings/queues/crons: **none**.
- Screens: none.

## Test plan

- `test/architecture/knip-doors.node.test.ts` (node: knip runs on Node
  and reads the disk, which workerd cannot). It asserts the report reads
  at least one door file, so an empty report from a broken run fails, and
  that each door's names equal its pin. Checked by hand: deleting a
  pinned name's last importer, and dropping a pin line, each fail it.

## Issues

- Closes #1046.
- Comments on #1007 (upstream recommendation).

## Open questions

- Proceeding on counting types as door names (127, not 73). Veto it and
  the pin drops to exports only.
