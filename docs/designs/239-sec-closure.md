# Design: 239 sec-closure

## Problem

Wave 15 lane 15a: #766's third Done item. The 2026-11-14 security audit
read the code and ran nothing, so some of what it wrote rests on how
workerd, the production build, a browser or a vendor behaves. Each of those
statements is run here and confirmed or struck. The ones that need a
deployed Worker wait for the first deploy, and this lane lists them for it.

## Approach

The statements are read in place in the audit's private folder, from a
list the security-audit session triages (about 50 lines; it also says
which the third audit round covers anyway). This doc, the commits, the
test names and the PR name audit drafts by id only (SA-…) and say what
the code and the platform do.

Each line gets the cheapest check that can observe it:

| the statement is about         | check                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| workerd, D1, R2, queues        | a `worker`-project vitest that drives the real runtime                                                                 |
| what the build emits           | a check of `dist/` after `npm run build`, beside `check:bundle`                                                        |
| what a browser sends or blocks | a `browser`-project vitest in Chromium; a Playwright spec only if the statement needs the app's own server and cookies |
| a vendor's service or limits   | the vendor's own documentation, with the page and the date read                                                        |
| a deployed Worker only         | a row in `docs/launch/deployment-plan.md`, not a guess                                                                 |

Each line then ends one of four ways:

- **Holds, and a test can see it**: the test stays, as a pin on the
  behaviour (law 10: anything the platform binds, a test asserts).
- **Holds, on the vendor's word**: recorded with its source. No test.
- **Needs the deploy**: a deployment-plan row saying what to look at.
- **Does not hold**: the lane stops and tells the coordinator. Nothing
  public is written about it; it is scoped with the owner.

No production code is expected to change. If a check needs a seam in
`src/`, or a file another lane owns, the lane asks the coordinator first.
A result table by id is added to this doc as the checks land.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none**. `package.json` may gain one script on
  `postbuild` for the built-output check (a guess until the list is read).

## Test plan

Named when the triaged list arrives; the kinds are the table above. New
tests go in `test/platform/`: `*.test.ts` (worker), `*.browser.test.ts`
(Chromium). A statement about an existing module's behaviour is pinned in
that module's own test file instead.

## Issues

- Refs #766 and #756; this lane ticks and closes neither.
- Opens: none yet.

## Open questions

- Where each line's result is recorded privately: waiting on the
  security-audit session's answer, through the coordinator.
- The built-output check as a `postbuild` script rather than a `node`
  test: `npm test` does not build first, so a test reading `dist/` would
  read a stale or missing build. Proceeding on the script.
