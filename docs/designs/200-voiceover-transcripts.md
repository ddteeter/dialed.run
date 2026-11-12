# Design: 200 VoiceOver transcripts

## Problem

`docs/launch/voiceover-script.md` gives the owner each screen's expected
speech from its checked-in transcript. A transcript is a test's final
state, so fifteen states the VoiceOver pass walks through have none, and
four screens have one at desk width only (#582). The script can only say
"no transcript" there.

## Approach

A test that ends on each state at 390 wide, in the spec that already owns
its screen. No new spec file and no new journey. A sibling seeded straight
to the state where a test passes through it and moves on; an existing test
ended at the phone's width where nothing it asserts is about the desk; two
states in one final state where the script walks them in a row.

| state (#582)                                   | where it ends                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Create account refused; its password shown     | `conformance/auth-forms`, one test                                |
| first-run username                             | `account/username`                                                |
| O3 tap-list; P2.5 with a piece open            | `conformance/onboarding-desk`, two tests                          |
| A1 conditions arrived; its start-time row open | `run-logging/run-logging`, one test                               |
| A2 suggestion offered; A2b category sheet      | `conformance/a2-attach`, two tests                                |
| retire confirm                                 | `conformance/closet-detail`                                       |
| H after Follow; search with a hit              | `conformance/feed-gh`, `feed/feed-unconfirmed`                    |
| Notifications, unread and Mark all read        | `conformance/notifications-m`                                     |
| Settings › Privacy; delete-account sheet       | `conformance/system-settings`, two tests                          |
| phone width: closet grid, Add a garment        | existing tests in `conformance/closet-empty`, `closet/closet-add` |

No test for three:

- **Turnstile** cannot be transcribed: e2e runs Cloudflare's always-pass
  key, where the widget draws nothing, and a real challenge is a
  cross-origin frame the reader cannot enter. The script says so.
- **The + Add sheet** is not a state: the launcher navigates to A1, which
  has a 390 transcript. The script's line is corrected.
- **The receipt at 390** has a transcript already (`conformance/a3-verdict`).

**The reader read `checked` from the attribute.** Guidepup takes a native
checkbox or radio's state from its `checked` attribute, so one ticked
since render was transcribed "not checked". `transcriptOf` now mirrors the
property onto the attribute while it reads, and puts it back. Seven
existing transcripts change by one line each, a picked radio.

Each new transcript was reviewed with the `a11y-judgment` skill.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none built. One a11y fix: P2.5's "Name it" buttons carry
  their piece's name, visually hidden (`NamePieces.tsx`).

## Test plan

- edge case / conformance (Playwright): the tests above. A transcript is
  the a11y fixture's reading of a real page after the server hop, which no
  dom test produces.
- Cost, measured on this machine's CI-style run (fresh D1, all projects,
  `A11Y_COVERAGE=1`): 13 tests added and 2 moved to the phone's width;
  168 → 181 tests; the dev-server run 10.2 → 11.9 min, the production
  build's 9.6 min. CI's `e2e` job time is in the PR body.
- dom (`test/onboarding/name-pieces.dom.test.tsx`): each Name it button
  is named for its piece.
- `e2e/support/a11y-transcript.spec.ts`: a box ticked since render reads
  as checked, and the page is left as it was.

## Issues

- Closes: #582.
- Opens: #589, #591, #592, #593, #594 (Design asks) and #590, #595
  (owner questions), one per finding not fixed here.

## Open questions

- None.
