# Design: 190 mutation shards (#563, #510)

## Problem

The `modules/safety (ts)` CI shard has not passed on main in five runs: it
takes 4–6 hours (the job limit is 6) and leaves two survivors. Main is not
at 100% for safety, no safety seed is ever uploaded, and #518 is blocked on
it. Separately, every local push gate runs Stryker cold, because one `{}`
negation trips guardrails-core#168, and `modules (tsx)` is the next-longest
shard (#510).

## Approach

**Measured first** (main run 42691704205, `vitest-runner` source, and an
import graph of `src` + `test`):

- A static mutant runs every test file *related to its own file*
  (`mutantRun` passes `relatedFiles: [file]`, no test filter). Through the
  safety barrel, 46 of the 51 safety files relate to ~142 test files;
  `blur/*`, `release.ts`, `review-audit.ts` and `desk-kit.ts` to 3–7.
- Stryker estimated the 292 static mutants (10%) at 86% of the shard. The
  progress log agrees: ordinary mutants were done at 1 h 06, statics took
  the next 2 h 40. An AST estimate puts ~163 of them in `inputs.ts` and
  `contracts.ts` (module-scope zod schemas), which also hold 10 of the 13
  timeouts.
- Only `blur/*` relates to the two `*.browser.test.ts` files, so Chromium
  is in a safety dry run only because blur shares the shard.

**Changes, one config commit** (any mutate edit drops every CI seed):

1. Kill the survivors: a listing whose requests name nothing of ours sends
   no other-photos or matches read (`takedown-requests.ts:563`, `:567`);
   `confirmTokenHash("abc")` against the SHA-256 vector, whose 0x00/0x01
   bytes need the padding (`takedown-limits.ts:135`).
2. Split `src/modules/safety/**/*.ts` into three entries balanced by
   estimated cost (ordinary mutants plus ~22× per static): one led by
   `inputs.ts`, one by `contracts.ts`, one by `blur/**` (with the
   browser-tested code, so the other two dry runs skip Chromium). Model:
   ~314 worker-minutes each, about 80–90 min a shard instead of 236.
3. Split `src/modules/**/*.tsx` (#510) by the seed's real counts:
   safety+auth+ops+notifications (177 static / 2,637), closet+account+email
   (179 / 2,494), feed+runs+onboarding (194 / 2,813). Route negations stay
   on the first.
4. `!src/routes/@{$handle}.tsx` → `!src/routes/*$handle*.tsx`: no
   character guardrails-core leaves unmodelled; matches that one file.
5. `.gitignore` the fingerprint; fix the `//concurrency` dry-run figure
   (~7m50s, not ~50s); concurrency stays 4.

`mutation.yml` reads the array, so it does not change; seeding downloads
`stryker-incremental-*`, so new slugs need nothing either.

## Contract touches

- Schema changes: **none**. Routes: **none**. Bindings/queues/crons: **none**.
- Screens: none.

## Test plan

- `takedown-requests.test.ts`, `takedown-abuse.test.ts`: the two survivor
  kills above (worker), proved with Stryker on the lines.
- `mutation-config.test.ts`: every non-negated `src/modules` file is in
  exactly one entry, and no entry names a dead path (the lib check, widened).
- `server-functions-are-glue.test.ts`: negations read as globs; each route
  negation matches exactly one route; no negation uses syntax
  guardrails-core cannot model (`{}[]()?+:!@`).

## Issues

- Closes: #563, #510.
- Opens: the deeper fixes below, if the owner wants them.

## Open questions

- Not done here, reported instead: narrowing per-static cost needs either
  fewer module-scope mutants in `inputs.ts`/`contracts.ts`, or tests that
  reach safety without the barrel; `ignoreStatic` would cut the time most
  but un-ratchets module-scope code (owner call).
