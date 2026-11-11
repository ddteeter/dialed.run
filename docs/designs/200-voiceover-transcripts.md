# Design: 200 VoiceOver transcripts

## Problem

`docs/launch/voiceover-script.md` gives the owner each screen's expected
speech from its checked-in transcript. A transcript is a test's final
state, so fifteen states the VoiceOver pass walks through have none, and
four screens have one at desk width only (#582). The script can only say
"no transcript" there.

## Approach

A test that ends on each state at 390 wide. No new spec file and no new
journey: each state goes in the spec that already owns its screen.

- **A sibling seeded straight to the state**, where a test passes through
  it and moves on (an open sheet it then closes): sign in, seed, open, one
  or two actions, end. Cheaper than replaying the flow.
- **An existing test that ends at the phone's width**, where its final
  state is already the one wanted and nothing it asserts is about the
  desk: no new test, and its transcript becomes the phone's.
- **Two states in one final state**, where the script walks them in a row
  on one screen (Create account refused, then its password shown; A1's
  conditions arrived, then its start-time row open).

| state (#582)                                     | spec                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Create account refused; password shown           | `conformance/auth-forms`                                               |
| Turnstile                                        | see Open questions                                                     |
| first-run username                               | `account/username`                                                     |
| O3 tap-list; P2.5 with brand suggestions         | `conformance/onboarding-desk`                                          |
| the + Add sheet                                  | `conformance/a1-upload`                                                |
| A1 conditions arrived, start-time row open       | `run-logging/run-logging`                                              |
| A2 suggestion offered; A2b category sheet        | `conformance/a2-attach`                                                |
| retire confirm                                   | `conformance/closet-detail`                                            |
| H after Follow; search with a hit                | `conformance/feed-gh`, `feed/feed-unconfirmed`                         |
| Notifications, unread and Mark all read          | `conformance/notifications-m`                                          |
| Settings › Privacy; delete-account sheet         | `conformance/system-settings`                                          |
| phone width: closet grid, Add a garment, receipt | `conformance/closet-empty`, `closet/closet-add`, `verdict/verdict-row` |

Then, once #584 has merged, the script's "no transcript" steps take the
expected speech and `voiceover-script-transcripts.test.ts` pins the new
paths.

Each new transcript is reviewed with the `a11y-judgment` skill before it
is committed. One that reads wrong is a finding: fixed here if it is
small and changes no wording or drawn composition, otherwise the
coordinator's.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none built. Any a11y fix a new end state surfaces is listed in
  the PR.

## Test plan

- edge case / conformance (Playwright): the tests above. A transcript is
  the a11y fixture's reading of a real page after the server hop, which no
  dom test produces.
- Cost: the number of tests added and the e2e job's time before and
  after are recorded here once measured.

## Issues

- Closes: #582.
- Opens: one per finding that is not fixed here.

## Open questions

- Turnstile. The e2e environment runs Cloudflare's always-pass test key
  with `interaction-only`, so the widget draws nothing, and a real
  challenge is a cross-origin frame the reader cannot enter. What can be
  captured is what the page says when the check does not load.
