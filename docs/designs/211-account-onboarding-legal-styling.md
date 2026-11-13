# Design: 211 Account, onboarding and legal: styling fixes and Round 55 builds (wave 8, lane 8c)

## Problem

The 2026-11 styling audit found auth, landing, account, notifications,
safety, onboarding, settings, the Call, the legal pages and /open-source
drawn differently from their boards (#625, #629, #630), and Round 55 ruled
the findings that needed Design (#633, #637, #638), plus where X2's phone
bell sits (#648, Design 186). Each built-wrong finding is confirmed against
a fresh capture before it is fixed.

## Approach

Fix each finding at its origin; the rulings on each issue are the spec.

- **One signed-out frame (R55·176, coordinator-assigned):** a new
  `src/ui/SignedOutFrame.tsx` holds the bar (64 desk / 56 phone, every
  width, pink-bracketed wordmark at TYPE.title, Log in link, Request access
  pill at ≥720, "Open in the app" for a signed-in viewer on a public page)
  and the five-link footer. `TopBar`/`Layout`'s signed-out branch and
  feed's `PublicFrame` both render it (line-disjoint edits; 8b owns the
  rest of those files). "Request an invite" goes; "Have a code? Join"
  becomes "Have a code? Create an account".
- **Auth and landing:** "Forgot it?" on the Password label row (A-06);
  one failure band at a time, newest at the control that failed, no
  repeated lines (177, A-11); sign-up's closing lines (178, A-17); landing
  on MEASURE.page, sentence-broken headline, signed-in "Go to your feed"
  (175, A-09, A-10); the signed-out 404 in the frame (174, A-05).
- **Receipts (181, B-13):** `SignedOutReceipt` replaces the panel's title:
  teal MONO.xs kicker, receipt title at TYPE.display, on every done receipt.
- **Account (B-08, 182, P1-01, P1-02, B-11, B-16):** U1 rows end in one
  bold `--cold-text` verb, no chevron; Sign out everywhere is the last
  SIGN-IN row ("Every device"). Change email goes through `ShellForm` (the
  summary on 2+ errors, one spacing). Every "Current password" is the
  Show-able `PasswordField`. The confirm-email sheet's buttons are a
  matched full-width pair (its heading is 8a's Sheet). /account/username
  drops "change it in settings" (owner, 2026-11-13).
- **Notifications (183, 184, B-12):** TYPE.body rows, `--muted` chevron
  only on a row that opens something, read rows `--quiet`; a 44 count row
  above the list (ALL READ once read); one `--panel` list at desk. The
  Strava row opens the upload with the day the row arrived filled in
  (owner, 2026-11-13; no activity data).
- **Blocked runners (B-01, P3-09, P3-10):** W2 as drawn: bordered
  explanation card with hanging tags, card rows (avatar, bold @handle,
  BLOCKED date, outlined UNBLOCK pill), handle truncates, tinted closing
  note with its first sentence back.
- **Onboarding, settings, the Call:** F-02 (full-bleed ink header, collapses
  at desk, one THE CALL), F-05 (bold row title, joined segmented theme
  control), F-07, F-08, F-09 (three segments, full-bleed band, bar at 390),
  P1-07 (chips keep width), 228 (city, region abbreviation, country; one
  line chip; message order), 229 (P2.5 open/error/named rows), 182.1 (index
  rows end in a chevron, state in the subtitle), 230 (groups; REVIEW tag),
  169.1 (sub-page back link on the bell's row), 227 (after 8a's legend prop).
- **Legal and /open-source (A-01, A-02, A-12, A-13, P4-02, P4-03,
  220–226):** fixed 240 rail; display-face section headings with hairline;
  short titles; plain dialed.run in prose, OWNER markers on hi-viz; the
  draft notice block; mailto links; the processors table as cards below
  desk and broken out right at desk; licence text reflowed; R39's four
  notice rows, filtered by search; icon-set chevron and clear.
- **X2 (#648, 186):** `LoaderFailed` reads the failed route's
  `staticData.title` and draws that screen's first row (title, bell at its
  end) above the band. Each route gets a one-line `staticData.title`
  (coordinator-approved across lanes).

## Contract touches

- Schema: **one additive nullable column**, `users.privacy_seen_at`
  (230; owner-approved 2026-11-13). Migration numbered past main and open PRs.
- New route files: **none**. Bindings/queues/crons: **none**.
- Screens: Au1–Au3, landing, X1, X2, U1, P1 pages, M/S2, W2, O1, P2, P2.5,
  P3, K, legal, /open-source. Deltas: what Round 55 doesn't already record.

## Test plan

- `*.dom.test.tsx` (ui) per changed component, each assertion written to
  fail on its mutant (row ends, band replacement, chevron only when linked,
  ALL READ, chip width, place-name format, rail width, card table, mailto).
- Worker tests for `privacy_seen_at` stamping and the REVIEW predicate, and
  the place-name shortener (pure, vitest).
- Existing journeys and transcripts re-recorded (auth, account, legal,
  onboarding, notifications); the R-102 conformance for X2.

## Issues

- Closes: #625, #629, #630, #633, #637, #638, #648 (partly-finished ones
  listed, not closed).
- Opens: whatever is found or deferred, listed in the PR.

## Open questions

- 220 table cards: the label for each value is its column header (guess).
- 175's image slot stays empty (#523).
