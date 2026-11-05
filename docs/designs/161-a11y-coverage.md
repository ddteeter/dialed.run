# Plan: 161 Accessibility coverage

Status: **approved** (owner, 2026-10-29); step 0 done (2026-10-30), results
below. This is a plan, not a lane design doc: it sequences the work and
names what needs the owner. Step 0 is a measurement, and the steps after it
are re-costed from what it finds.

## Why

The Accessibility Contract's X3 opens with _"axe-core on every route … zero
violations at AA"_. Today axe runs on one file, `test/ui/axe.dom.test.tsx`,
over the `src/ui/` primitives in happy-dom. No screen, no route and no
module component is checked. That file's comment says the module components
are covered from their own suites, and none of them import `violations`.
Contrast is checked against the token table, never against a rendered page.
Nothing checks keyboard order, hit areas or reflow in a browser, and nothing
records what a screen reader would say.

The fix is not a hand-written list of routes and states. The states already
exist: the e2e and conformance specs seed and visit them. So the checks ride
on those specs, and **coverage says which UI branches have been checked**.
That figure is then ratcheted the way the mutation score is.

```
every e2e spec ──► a11y fixture (before every action, in the page)
                     ├─ axe (AA, every rule on, real CSS)
                     ├─ hit areas ≥ 44×44, focus ring visible
                     └─ V8 coverage of src/**/*.tsx
end of each test ──► other width · Tab walk · 320px reflow · transcript snapshot
end of run ──────► a11y branch coverage vs baseline · every route visited
PR ──────────────► transcript diff ──► Claude review (advisory comment)
```

## Steps

Each step is one PR. "Done" means its checks are green in CI.

**0. Spike: measure on one lane (closet).** Add the axe part of the fixture
to the closet specs only. Record the time added per spec, the violation
count, and whether `@guidepup/virtual-screen-reader` runs inside a
Playwright page.
_Done:_ the numbers are in this doc, and the steps below are re-costed
from them. **Go/no-go point for the owner.**

**1. The fixture: `e2e/support/a11y.ts`.** Built 2026-10-31. Every spec
imports `test` from it instead of `@playwright/test`. The action methods of
`Locator`, `Page`, `Keyboard` and `Mouse` are wrapped to run the checks
first, so every state a spec acts on is checked once. It checks:

- every axe rule tagged WCAG A or AA, read from axe rather than listed,
  plus `region` (`a11y-findings.ts`'s `RULES`);
- `target-44`: a 44×44 hit area, counting a control's labels and a
  `::before` drawn proud of it (`target-seam`), and honouring the app's
  own `data-target="inline"`;
- `name-space`: a space that is a text node of its own between two
  others, which Chromium leaves out of the accessible name ("7waiting").

A finding is named by rule, route and element, and the element by its tag
and naming attributes (`data-slot`, `data-part`, `name`, `type`, `role`,
`aria-label`, `href`), never its markup. Markup differed between the dev
server and the built Worker, so the first baseline matched on neither.
Anything not in `e2e/a11y-baseline.json` fails the test at its end.
`A11Y_RECORD=1` fails nothing and writes every finding, which is how the
baseline is made: the union of a run on each server.
_Fixed here rather than baselined:_ 420 of the first 468 findings were
`region`, because the signed-in `Layout` had no `<main>` and neither bar
was a `<header>`. Baselining them element by element would have failed any
PR that added content to almost any screen. `Layout`'s content is now the
page's `<main>`, both bars are `<header>`s, and `SystemState`'s signed-out
frame is a `<main>`. Onboarding's five routes and the Strava callback still
render no landmark; they are in the baseline for step 6.
_Tests:_ `e2e/support/a11y.spec.ts` serves a page with one of each problem
planted and asserts exactly those are found, and that a label-wrapped
checkbox, an inline link, a seam chip and a hidden file input are not.
_Not done:_ checking before each web-first `expect`, for states no action
is taken on. Wrapping `expect`'s matchers needs a proxy over every chained
form (`.not`, `.soft`, `.poll`); it waits until step 3's coverage shows
how much it would add.

**2. End-of-test checks.** These run once per test, on its final state:

- resize to the other width (PHONE ↔ DESK) and run axe again;
- Tab through the page: every control is reached, the focus ring is
  visible and measured, and nothing traps focus;
- at 320px, nothing scrolls sideways.

Focus returning when a sheet closes stays in `use-return-focus`'s unit
test, because the end state can't see it.
_Done:_ as in step 1.

_How (2026-11-02):_ the fixture's teardown runs them after its last
check, on a test that passed, on the app's origin. The action wrapper is
off by then, so the walk's own key presses are not checked as states.
In order:

1. **The Tab walk, at the test's own width** (`a11y-walk.ts`, in the
   page; Node presses the real Tab key, so `:focus-visible` is the
   browser's own). It is a line, not a loop: a stop is placed first in
   the page (or in the open modal), focused, and Tab is pressed until
   focus is back on it or leaves the page, capped at twice the page's
   control count. Looping does not work: Chromium's Tab past the last
   control lands on the page, and the next one resumes from wherever
   focus last started, not from the top, so a loop skipped the login
   form after a server fault. It starts only once focus has held still
   for longer than the longest motion token (capped at 2 s): the app moves
   focus on a token's timer (Try again, `DURATION.instant` after a
   failure), and a walk already under way followed the jump and skipped
   what lay between (Au4, CI, 2026-11-03). Each stop is measured:
   - `focus-ring`: no 2px outline on the element, its labels, the next
     sibling (Tailwind's `peer`) or an ancestor up to three levels
     (`.field-box` draws the ring for its input);
   - `focus-obscured`: the stop is entirely covered (WCAG 2.4.11), read by
     `elementFromPoint` at its centre and four inset corners;
   - `focus-trap`: Tab left focus where it was for more than three
     presses in a row, or the cap ran out first. One press can land on a
     busy page and move nothing (CI's preview leg saw it once), and a trap
     holds focus every time. An iframe (its own document takes the
     presses) and a date or time input (Chromium tabs through its day,
     month and year) may hold focus for 30 presses.

   Before the walk, the page lists its controls: anything focusable or
   with an interactive role, or drawn with `cursor: pointer` and not
   inside or around a control or a label (a clickable `<div>`).
   - `tab-unreached`: a control the walk never reached. A radio group
     counts once (arrow keys move inside it), and with a modal `<dialog>`
     open only the dialog's controls count;
   - `tab-order`: a positive `tabindex`, which reorders the page. Such a
     control comes before the walk's start, so it is not also unreached.

2. **The other width:** the one of `PHONE` and `DESK` farther from the
   test's width. axe and the step 1 checks run again there.
3. **Reflow at 320×568** (WCAG 1.4.10): `reflow` when the page scrolls
   sideways, named by each element that starts the overflow (its parent
   fits), not inside a container that scrolls or clips on its own. When
   no element's box overflows, it is text: a word too long to wrap, named
   by the deepest box it spills out of.

A failed test skips them: its last state is not one it meant to reach.
Each finding is named and baselined like step 1's.
_Tests:_ `a11y.spec.ts` gets a probe per check: a ring removed, a
covered control, a trap, a clickable `<div>`, a positive `tabindex`, a
phone-only image without alt, and a 400px box. It also plants what must
not be found: a radio group, a field-box input and a scrolling strip.

**3. Coverage: what was checked.** On the dev leg only, where Vite serves
source maps, the fixture collects Chromium's V8 coverage through
`monocart-coverage-reports` and maps it back to `src/ui/**/*.tsx` and
`src/modules/**/*.tsx`. Branch coverage of that set is the a11y coverage
figure, and a baseline file holds it at its last value, give or take its
noise. A route check reads
the URLs the run visited, matches them to `routeTree.gen.ts`, and fails on
any route never visited and not listed with a reason.
_Known limit:_ a state no action is taken on, such as a spinner
mid-submit, renders and counts without being checked. A spec that asserts
on it closes the gap: step 1 also checks before each web-first `expect`
if the spike's cost allows it.
_Tests:_ the report reader is pinned against a fixture report; removing a
visit from a spec drops the figure.
_Done:_ the figure is printed in CI and can't fall by more than its noise.

_How (2026-11-03):_

- **When it measures.** Only on the dev leg, and only when the whole suite
  runs: in CI, or locally with `A11Y_COVERAGE=1`. A local run of one folder
  would fail both checks, so measuring is opt-in there.
- **Coverage.** The fixture starts Chromium's JS coverage with each test's
  page (`resetOnNavigation: false`) and stops it after the end-of-test
  checks. It keeps only the entries Vite serves as `src/ui/**/*.tsx` and
  `src/modules/**/*.tsx`, and hands them to `monocart-coverage-reports`,
  which caches them on disk between tests. The global teardown
  (`a11y-coverage-teardown.ts`) maps them through Vite's inline source
  maps and reads the branch percentage.
  - Every component counts, loaded or not (monocart's `all`, each unloaded
    file compiled with Vite's `transformWithOxc`; its branch counts match
    the served files'). Counting only what a run loaded made the
    denominator move: `LinkLanding` was preloaded by one run and never
    fetched by the next, and a component no spec loads never lowered the
    figure.
  - Chromium reports only the scripts of the document still loaded, so a
    second full page load in one test used to drop the first. The fixture
    takes the coverage before each navigation it drives (`goto`,
    `reload`, `goBack`, `goForward`). A full load the app makes itself
    (a form post, `location.assign`) still drops the document before it.
    The app's own navigations are client-side, and those keep their
    modules.
  - Vite's maps name each source by its bare file name, so two
    `index.tsx` files would merge into one. Each source is named by the
    path it was served at instead.
- **The visited routes.** The fixture records each path the test's page
  navigated to, including client-side navigations (Playwright's
  `framenavigated` fires for both). The teardown reads the routes from
  `routeTree.gen.ts`'s `FileRoutesByTo`, so the list is derived, never
  restated, and matches each visited path to one:
  - `$param` matches one segment;
  - `$` matches the rest;
  - `{$handle}` matches the rest of its segment.
- **Both checks read `e2e/a11y-coverage.json`.** It holds:
  - `branches`, the figure at its last value;
  - `unvisited`, each route no spec opens, with the reason. Endpoints
    (`/api/*`, `/og/*`, photo routes) are routes but not pages.

  The run fails:
  - when the figure falls more than `FIGURE_NOISE` (0.25 points) below
    `branches`. Two fresh-database runs of the same code differed by four
    branches of about 2,200: a component preloaded or not, and one
    `EntryDetail` branch that reads the shared data. A screen no spec
    reaches any more is tens of branches;
  - when a route is neither visited nor listed;
  - when a listed route was visited, so its reason is stale.

  `A11Y_RECORD=1` writes the figure instead of failing on it. A rise past
  the noise is printed, with a reminder to raise the baseline; one inside
  it is the next run's fall, so it is not kept.

- **CI.** The teardown prints the figure and appends it to
  `$GITHUB_STEP_SUMMARY`, so no workflow changes. The HTML report is not
  uploaded: the Actions bill is artifact storage.
- _Known limit:_ the noise band. A loss smaller than 0.25 points, a
  handful of branches, passes; the route check still catches a screen no
  spec opens.

**4. Transcripts.** At the end of each test, record what a screen reader
would say, with Guidepup's `spokenPhraseLog()`; step 0 showed it runs in the
page. Each is a checked-in snapshot
named by the test, so a change in what's announced shows up as a reviewed
diff.
_Done:_ the transcripts are committed and the snapshots pass.

_How (2026-11-03):_

- **When.** In the fixture's teardown, on a test that passed and ended on
  the app's origin. It runs after the final check and before step 2's
  checks, which resize the page, so it reads the test's own width. The
  fixture's own spec (`a11yMode: "collect"`) records none.
- **Loading Guidepup.** Its browser build is one ES module. The app's CSP
  (`script-src 'self'`) refuses a blob or inline module, which is how
  step 0 loaded it on a page without the CSP. `a11y-transcript.ts`
  rewrites the build's one `export {…}` into a global and evaluates it
  through the debugger protocol, which the CSP does not govern. Nothing
  is injected into the app's pages before the end of the test.
- **The walk.** `next()` from the top until "end of document", which is
  where Guidepup wraps to the start. It is capped at 1,500 phrases; the
  longest page today, `/open-source`, is about 1,100.
- **What is normalized.** ULIDs, day and month names, and numbers, which
  are seeded handles, counts, times and dates. Heading levels and list
  positions stay. A transcript records what is said and in what order;
  the values are other tests' business.
- **Where.** `e2e/transcripts/<spec path>/<test title>.txt`, one per test,
  through `snapshotPathTemplate`. The template has no platform suffix, so
  a laptop and CI share one file. To accept a change, run
  `npx playwright test --update-snapshots` and review the diff. A new
  test with no transcript fails in CI until its file is committed.
- Both servers must say the same thing. The dev and preview legs read
  the same files.

_Tests:_ `a11y-transcript.spec.ts`: a probe page's exact transcript
(levels, positions, stop at the end), the normalization, and the module
rewrite.

**5. Claude reviews the transcript diff.** A PR workflow sends the
transcript diff and the contract's rules to Claude and posts one advisory
comment: unclear names, repeated announcements, reading order that
contradicts the layout, an error read before its field. It is advisory
only: its verdicts aren't deterministic, so it never fails a check.
_Done:_ it comments on a PR that changes a label.

_How (2026-11-03):_ `.github/workflows/a11y-review.yml`, on
`pull_request` when `e2e/transcripts/**` changes. It is built like
`dependabot-pr.yml`'s review, for the same reasons: the job holds a key
and reads text it does not control.

- **`review`** (`contents: read`):
  - The network is fenced by `harden-runner` to the hosts the action
    installs from and Claude's API.
  - The transcripts' diff against the base is written to a file, with
    no model, and capped at 200 KB.
  - Claude reads the diff and applies the `a11y-judgment` skill's
    criteria (step 9b), reading the contract and the source with Read,
    Grep and Glob only: no Bash, web or writes. It answers in a JSON
    schema of a summary and up to 30 findings (transcript, phrase as
    said, problem, fix).
- **`post`** (`pull-requests: write`, no model) screens that output as
  data before posting one comment:
  - the agreed shape and sizes;
  - nothing shaped like a credential;
  - every `@` defused.
- **Advisory.** Both jobs `continue-on-error`, nothing is a required
  check, and the comment says it is a model's reading.
- **The key.** The repository secret `ANTHROPIC_API_KEY`. Today the key
  exists only in the `dependabot-review` environment. Until the owner adds
  the repository secret, the job logs a notice and skips. A fork's PR gets
  no secrets and skips the same way, so nothing runs this repo's key on
  code from outside it.
- _Not done here:_ the "Done" demonstration. It needs the secret, then a
  PR that changes a label.

**6. Fix the backlog.** Work through `a11y-baseline.json`, grouped by the
lane that owns the file, until it is empty. Contrast in a real browser is
the likely bulk.
_Done:_ the baseline is empty and the file is deleted.

_How (2026-11-03):_ 28 findings, in five kinds, plus the owner's two
decisions.

- **`target-44`** (13): every `<select>` and the runner search.
  - `FormField`'s box held its control centred in 12px of padding. A
    select drew its own 37px box inside the box.
  - The box now has no vertical padding: `min-h-field` alone makes it 50. Each select fills it borderless (48px), the way a text input sits
    in it.
  - The search input stretches to its 48px box.
  - The text fields look the same. The selects no longer draw a box
    inside the box.
- **`color-contrast`** (8), each against the token rules in `tokens.css`:
  - "Pink as text is `--cold-text`": Delete account.
  - "Text on `--action` is always `--accent-ink`": the shared
    `SubmitButton` and Copyright holds' button. The Desk is an inverted
    block, so `text-ink` there was chalk on pink.
  - NowGoRun's ink block was `bg-ink text-ground` with the paper values
    inside, so `--muted` and `--cold-text` failed on ink. It is now a
    `ground-ink` block, which redefines them.
  - `--label`/`--muted` grey is 4.0:1 on `--tint`. Text on a tinted row
    (a saved backlog row, the file strip) is `--quiet`.
- **`label-content-name-mismatch`** (1): the start-time button is named
  by what it shows, then what it does: "6:04 AM · Changed, change start
  time" (WCAG 2.5.3).
- **`p-as-heading`** (3): `BracketHeadline` and the conditions block's
  state titles are `<h2>`s under the feed's `<h1>`.
- **`reflow /desk`**: the rail is beside the content from `wide` and
  above it below `wide`.
- **Brackets**: the wordmark's bracket glyphs are `aria-hidden`.
  `Bracketed` already hid its own.

**7. `eslint-plugin-jsx-a11y`.** The owner adds it to the ESLint config at
`recommended`. Its findings are fixed in the same PR.

_How (2026-11-03):_ `eslint-plugin-jsx-a11y-x` 0.2.0, the es-tooling fork,
at `recommended` on `src/**/*.tsx`.

- **Why the fork (owner, 2026-11-03).** Upstream's last release (6.10.2,
  October 2024) declares ESLint 9 at most as its peer, and this repo is on 10. Upstream's ESLint 10 issue (#1075) and three community PRs are open;
  the sole maintainer has said it will come, without a date. The fork has
  the same 34 rules, ESLint 9 and 10 as its peer, and is kept by the e18e
  lead. Both ran clean under ESLint 10 here and found the same seven
  problems. Moving back is the import and the rule prefix.
- **What it found, and the fixes:**
  - `img-redundant-alt` (3): alts that said "photo", which a screen reader
    already says. "Reported", "Reported garment", "Tap to sample a shade".
  - `no-noninteractive-element-interactions` (1): the backlog's key
    handler sat on `<tbody>`. It is on each focusable row now; the row with
    focus answers, and a failed row's Retry is a plain button again.
  - `no-static-element-interactions` (3): wrappers that only catch keys
    bubbling from the controls inside (Escape to cancel, Enter to find)
    take `role="presentation"`, the plugin's documented case for it.

**8. Tidy.** Correct the comment in `test/ui/axe.dom.test.tsx`. It keeps
the primitives' states that no screen reaches, and points at the fixture
for everything else.
_Done (2026-11-03):_ the comment no longer says module components are
covered from their own suites. It points at the fixture for screens, and
names the states it keeps: invalid, pending, a failure band, an error
summary, a skeleton.

**9. Manual pass.** Add `docs/launch/voiceover-checklist.md`: the core
flows on a real iPhone with VoiceOver, covering gestures, the rotor and
Safari. Run it before friends get access.
_Done (2026-11-03):_ the checklist is eight gestures checked on every
screen, the five flows (join, log a run, closet, feed, You), and a runs
table. It is a gate line in `docs/launch/deployment-plan.md` §11, at
stage 1 (friends) and again at stage 2.

**9b. The judgment review (owner, 2026-11-04).** What no rule can check
(whether names, headings, errors and order make sense when heard) gets one
written set of criteria: the skill `.claude/skills/a11y-judgment`. It has
two branches. A full audit fans out over every transcript in subagent
shards. A PR review applies the same criteria to a transcript diff, and
step 5's workflow now reads the skill instead of carrying its own list.
Findings are flags for the owner to triage, never a gate. Automating a
real VoiceOver pass is deferred (R-177, #336).

**10. Make it required.** Once step 6 is done, the owner makes the a11y
check required in branch protection.

**Later: dark theme.** Task 111 hasn't shipped, so there is one theme. When
it ships, the end-of-test pass also runs with `data-theme="dark"`. A line
goes into `docs/tasks/111-dark-theme.md`'s test expectations.

## Step 0 results (2026-10-30)

Closet specs (3 conformance files and the closet demo, 10 tests), locally,
with the report-only fixture against without it:

| measure                                | value                                 |
| -------------------------------------- | ------------------------------------- |
| wall time, without → with              | 61.8s → 68.6s (+11%)                  |
| states checked                         | 71, plus 13 skipped as seen           |
| time inside axe                        | 1.7s in all, 25–40ms per check        |
| axe violations at AA                   | **0**                                 |
| planted violations caught (probe)      | image-alt, button-name, contrast      |
| controls under 44×44, as measured      | 39 (overcounted, see step 1)          |
| Guidepup in the page (blob-URL import) | works; the empty closet is 43 phrases |

- **Waiting for a quiet DOM does not work.** The first version checked
  after 150ms without mutations. The closet demo makes about 900 in ten
  seconds at machine speed (React re-setting `name` and `type` on form
  inputs, motion's inline styles) and got one check, at the end. Checking
  before each action is deterministic and caught 47 states in the same
  test.
- **Zero violations is real, not a broken check.** A probe planted a
  missing alt, an empty button and grey-on-white text in the closet; axe
  reported all three.
- **`region` is not a WCAG rule.** axe tags it `best-practice`, so the AA
  tags never ran it; step 1 adds the tag.
- **The hit-area count is wrong as measured.** It reads the bare
  `<input>`: a 13×13 checkbox inside a 44px label, or a 1×1 `sr-only`
  file input behind a button, counts as small. The real candidates are the
  closet form's `<select>`s at 37px tall and the radio overlays at 42px.
- **The first transcript already raises a question.** The empty closet's
  heading is announced as `heading, [Nothing in here yet], level 1`, and
  the logo as `[ / dialed / .run / ]`. Whether the brackets should reach a
  screen reader is not in the Accessibility Contract (open questions).

## Open questions

- ~~**Bracket notation and screen readers.**~~ **Decided (owner,
  2026-11-03): hide them.** The bracket glyphs in `Bracketed` and the
  wordmark become `aria-hidden`, so VoiceOver reads "Nothing in here yet"
  and "dialed.run". The drawing does not change. Step 6 applies it.
- ~~**The Desk at 320px.**~~ **Decided (owner, 2026-11-03):** step 2's
  reflow check finds `/desk` scrolling sideways at 320px, because the rail
  keeps its width. It is baselined, and step 6 stacks the rail above the
  content below the `wide` breakpoint.

## Cost

The `e2e` job takes about 8 minutes in CI (the 40–45 is the whole
Guardrails run), with one worker, because parallel workers lock the local
SQLite. Step 0 measured the axe part at about 11% on the closet specs,
which puts it under a minute for the suite. Steps 2 and 4 add one resize,
one Tab walk, one reflow check and one transcript per test. If the run
grows by more than about 10 minutes, the a11y checks move to their own job
on the dev leg instead of slowing the required `e2e` check.

## Owner decisions (2026-10-29)

- **Dependencies: approved** (dev only, under `docs/dependencies.md`'s
  rules): `monocart-coverage-reports`, `eslint-plugin-jsx-a11y`, and
  `@guidepup/virtual-screen-reader` if step 0 shows it runs in the page.
  `axe-core` is already installed.
- **ESLint config (step 7) and CI workflows (steps 3 and 5): approved.**
  These files are human-managed, and this plan is the permission to edit
  them for these steps only.
- **API key:** the owner provisions it as the repository secret
  `ANTHROPIC_API_KEY` and caps the spend on the key itself, so the workflow
  sets no budget of its own. The workflow skips the review when the secret
  is absent.
- **Branch protection (step 10): approved.** The owner flips it once step 6
  is done.
- **Backlog (step 6): one sweep lane** fixes it across every lane's files.
