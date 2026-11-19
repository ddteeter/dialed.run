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

No production code changed. Each line's result is a row in the audit's
private results file, with what was run and the evidence.

## Results

What the repo gains, each pinning a behaviour a merged fix or the suite
itself rests on:

| check                                           | what it pins                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/platform/d1-statement-limits.test.ts`     | local D1 runs 100 bound values and refuses 101; it evaluates a 50-byte LIKE pattern and refuses 51                                                                                                           |
| `test/platform/d1-value-size.test.ts`           | local D1 refuses a value over its size limit with an error, counts bytes, and stores nothing in its place                                                                                                    |
| `test/platform/url-and-json.test.ts`            | workerd's URL parser keeps a host's root dot (SA-L04); `JSON.parse` makes `__proto__` an own key (SA-L13)                                                                                                    |
| `test/platform/host-cookie.browser.test.ts`     | Chromium keeps a `__Host-` cookie only as the page's own host set it, and keeps one from `http://localhost` (SA-M35, SA-L17)                                                                                 |
| `test/platform/enforced-policy.browser.test.ts` | a document under the enforced policy is refused another origin, and reaches its own (SA-M40)                                                                                                                 |
| `e2e/auth/server-fn-origin.spec.ts`             | from real pages on another origin and another site, with Chromium's own `Sec-Fetch-Site` and cookies, a server function refuses (SA-M1); an unregistered id is never answered as a call that worked (SA-L08) |
| `test/feed/search.test.ts`                      | a handle prefix past D1's pattern limit answers nothing: the index read compares no row                                                                                                                      |
| `test/auth/create-auth.test.ts`                 | sign-up's two answers carry the same keys in the same order (SA-L06)                                                                                                                                         |
| `test/lib/photo-pipeline.test.ts`               | the header walk and Photon's decoder read the same frame of the same JPEG (SA-L05)                                                                                                                           |
| `scripts/check-bundle.ts`                       | the devtools panel is not in the client bundle                                                                                                                                                               |

Not pinned by a test:

- **A vendor's behaviour or limits**: recorded privately with the page
  and the date read (2026-11-18). No test can observe them.
- **What only a deployed Worker shows**: a list of platform checks, with
  no finding in it, handed to the coordinator for
  `docs/launch/deployment-plan.md`.
- **Already pinned**: where an existing test of a fix drives the same
  behaviour, the row names that test and nothing was added.

Two of the list's open questions became tracked items, SA-L21 and SA-L22
(design 244).

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none**
- `postbuild` gains no script: the built-output check went into
  `scripts/check-bundle.ts`, which `postbuild` already runs.

## Test plan

The Results table. New platform tests are in `test/platform/` (`worker`
and `browser` projects); a statement about a module's own behaviour is
pinned in that module's test file. The one Playwright spec is an existing
edge case, extended: only a real browser sets `Sec-Fetch-Site` and
attaches cookies, and only the running Worker answers.

## Issues

- Refs #766 and #756; this lane ticks and closes neither.
- Opens: #884 (`followerCount` scans the whole follows table), found on
  the way and not a security item.

## Answers (coordinator-15 and security-audit, 2026-11-18)

- Results are recorded in the audit's private folder, one row a line.
- `test/platform/` for the new tests; the built-output check inside
  `scripts/check-bundle.ts`, not a second `postbuild` script.
