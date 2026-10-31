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

**1. The fixture: `e2e/support/a11y.ts`.** It extends Playwright's `test`,
and every spec imports `test` from it instead of `@playwright/test` (41
specs, a mechanical change). An init script loads `axe-core` into the page.
The action methods of `Locator`, `Page`, `Keyboard` and `Mouse` are wrapped
to run the checks first, so every state a spec acts on is checked; a DOM
already checked (by hash) is skipped. Every AA rule is on, `color-contrast`
included, plus the `best-practice` tag for `region`, and the only way to switch one off
is a row in `decisions.md`. The same in-page pass measures interactive
boxes against 44×44, since axe's `target-size` checks 24px, counting a
control's `<label>` and any overlay that takes its clicks as part of its
hit area (the spike measured the bare `<input>` and was wrong). Failures
collect per test and fail it at the end, naming the rule and the element.
_Tests:_ a fixture spec over a deliberately broken page fails for each
check, so a pass means something.
_Done:_ every spec runs under the fixture; the existing backlog is listed
in `e2e/a11y-baseline.json` (step 6 empties it).

**2. End-of-test checks.** These run once per test, on its final state:

- resize to the other width (PHONE ↔ DESK) and run axe again;
- Tab through the page: every control is reached, the focus ring is
  visible and measured, and nothing traps focus;
- at 320px, nothing scrolls sideways.

Focus returning when a sheet closes stays in `use-return-focus`'s unit
test, because the end state can't see it.
_Done:_ as in step 1.

**3. Coverage: what was checked.** On the dev leg only, where Vite serves
source maps, the fixture collects Chromium's V8 coverage through
`monocart-coverage-reports` and maps it back to `src/ui/**/*.tsx` and
`src/modules/**/*.tsx`. Branch coverage of that set is the a11y coverage
figure, and a baseline file holds it at its last value. A route check reads
the URLs the run visited, matches them to `routeTree.gen.ts`, and fails on
any route never visited and not listed with a reason.
_Known limit:_ a state no action is taken on, such as a spinner
mid-submit, renders and counts without being checked. A spec that asserts
on it closes the gap: step 1 also checks before each web-first `expect`
if the spike's cost allows it.
_Tests:_ the report reader is pinned against a fixture report; removing a
visit from a spec drops the figure.
_Done:_ the figure is printed in CI and can only go up.

**4. Transcripts.** At the end of each test, record what a screen reader
would say, with Guidepup's `spokenPhraseLog()`; step 0 showed it runs in the
page. Each is a checked-in snapshot
named by the test, so a change in what's announced shows up as a reviewed
diff.
_Done:_ the transcripts are committed and the snapshots pass.

**5. Claude reviews the transcript diff.** A PR workflow sends the
transcript diff and the contract's rules to Claude and posts one advisory
comment: unclear names, repeated announcements, reading order that
contradicts the layout, an error read before its field. It is advisory
only: its verdicts aren't deterministic, so it never fails a check.
_Done:_ it comments on a PR that changes a label.

**6. Fix the backlog.** Work through `a11y-baseline.json`, grouped by the
lane that owns the file, until it is empty. Contrast in a real browser is
the likely bulk.
_Done:_ the baseline is empty and the file is deleted.

**7. `eslint-plugin-jsx-a11y`.** The owner adds it to the ESLint config at
`recommended`. Its findings are fixed in the same PR.

**8. Tidy.** Correct the comment in `test/ui/axe.dom.test.tsx`. It keeps
the primitives' states that no screen reaches, and points at the fixture
for everything else.

**9. Manual pass.** Add `docs/launch/voiceover-checklist.md`: the core
flows on a real iPhone with VoiceOver, covering gestures, the rotor and
Safari. Run it before friends get access.

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

- **Bracket notation and screen readers.** `Bracketed` leaves the brackets
  in the accessible name. Should they be `aria-hidden`, so VoiceOver reads
  "Nothing in here yet"? This is user-facing wording and the contract's
  call, so the owner (and design) decides; step 6 applies it.

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
