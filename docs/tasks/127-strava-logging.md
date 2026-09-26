# Task 127 — Strava & logging

Lane 3 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

The Strava integration looks finished and is not. The refresh path is
called only by a test, so a disconnect cannot revoke anything once the
access token is six hours old, and the retry fails every day forever
(finding 0.1). A runner who revokes us on Strava's side is ignored, which
Strava's policy forbids (0.2). The webhook accepts anyone's events (0.10).
This lane makes the grant lifecycle correct end to end, then builds round
25's logging and Strava rulings.

**Strava activity data is never stored, displayed or used** — CLAUDE.md,
and API Policy §5.3 (no AI application may see it). Nothing here changes
that; keep it true.

## You own

- `src/modules/runs/**`, except `delete-run.ts` and its component (128)
- `src/routes/runs/**`; 128 adds the delete wiring to `$runId.tsx`
- `src/routes/api/strava.ts`
- 121's feed files: `components/AttachKit.tsx`, `VerdictForm.tsx`,
  `VerdictChips.tsx`, `SpecificsSheet.tsx`, `NotedReceipt.tsx`,
  `BandHistory.tsx`, `chips.ts`, `band-signals.ts`;
  `src/routes/feed/attach.$runId.tsx`, `src/routes/feed/verdict.$entryId.tsx`
- `public/strava/` (the official button asset), and the Strava button's slot
  on O3 (additions only; the rest of onboarding is not yours)
- `src/lib/dates.ts` (STR-13; every lane uses it)
- Additions only to weather's `manual_conditions` read and write (125 owns
  `modules/weather`), for STR-12's sky column
- `e2e/run-logging/`, `e2e/verdict/`, new `e2e/strava/` (no demo `Covers:` T1–T3
  yet), `e2e/conformance/a*-*` and `r-*`, `test/runs/**`

## Work

**STR-1 · Refresh before use [F]** (0.1). Every call that needs a live
access token gets one through a single function that refreshes when the
token is expired or close to it, and stores the rotated pair. Today the
only such call is revocation. D-1's "broken after 3 failures / 30 min"
logic then either has a real caller or is dead code; decide which in the
design doc and delete it if dead. Tests: an expired token is refreshed
before the call; a 401 on refresh marks the connection broken and writes
`strava_broken`.

**STR-2 · The revocation outbox can succeed [F]** (0.1, §7). The outbox row
copies an access token that will be expired by the time it drains. Store
what a later refresh needs (`add_strava_revocation_refresh_token`,
additive, yours, if the design needs a column), and drain as
refresh-then-revoke. **D-103 is the owner's open question** on folding
`strava_revocations` into #101's generic `outbox`, and this rewrite is its
natural moment: put it in your design doc and ask. The default is to keep it
apart, because its rows carry a credential and the generic outbox forbids one
in a payload. Tests: a disconnect six hours after the
last refresh revokes on the first drain; a refresh refused as invalid
settles the row (the grant is already dead).

**STR-3 · Athlete deauthorization [F]** (0.2, §1.6). The webhook drops every
non-`activity/create` event. Handle `object_type: "athlete"` with
`updates.authorized: "false"`: enqueue it (a new message variant, law 9),
and have the consumer delete the connection's tokens and athlete id well
inside Strava's 30 days — at once, in practice — and tell the runner: an S1
row and a transactional email through 126's interface (after ACC-2).
Idempotent on redelivery. Tests: the event deletes the connection; a
repeat is a no-op; an event for an unknown athlete is acknowledged and
ignored.

**STR-4 · The webhook authenticates [F]** (0.10). Compare the event's
`subscription_id` with a `STRAVA_SUBSCRIPTION_ID` var (add its type to
`src/env/env.d.ts`); refuse a mismatch before any D1 or queue work, and
still answer fast. Moved here from 125's scope because it is the same file
as STR-3. The var's value is set in the deployment sweep. Test: a forged
event with the wrong id enqueues nothing.

**STR-5 · `POST /oauth/revoke` [F]** (§1.6). Strava's deauthorize endpoint
stops working on 1 June 2027. Move now, since STR-1 rewrites the same call.

**STR-6 · The 11th athlete [F]** (§1.6). The friends stage runs at Strava's
10-athlete cap. When the token exchange fails because the app is full, the
runner sees that, not a generic connect failure. Parse the failure
precisely; a test pins the response you key on. Design ask: the state and
its copy.

**STR-7 · The official Connect with Strava button [F]** (§1.6; round 26
#21). Strava's **orange** "Connect with Strava" asset on both themes, 48
tall, unaltered, left-aligned where our pill was, wrapped in our `<a>` named
"Connect with Strava", linking to `/oauth/authorize`, on **T1 and O3**.
Focus is rule 06, square, offset 2. While OAuth is in flight our
`[ Connecting ]` shows beside it and the asset never changes. Disconnect
stays our hairline pill. No "Powered by Strava" mark (we show no Strava
data). `data-part="strava-button"` is exempt from the palette check, and
nothing else is: add exactly that exemption. Vendor the asset from Strava's
brand kit under `public/strava/` with its terms beside it. The owner
applies for Strava review only after this is live.

**STR-8 · Round 25 [P]** (`Round 25 Rulings.dc.html`; design-deltas
"Answered in round 25").

- **Log a run is a desk page.** From 1040, A1–A3 use DS1's two columns:
  inputs and the primary action in the primary column (max 620, phone
  order), read-only context cards in a `data-part="rail"`. The rail never
  holds an input, button or radio, and a conformance spec checks that. A2b
  takes over the primary column; A3's verdict row stays at 390. 720–1039 is
  the 620 reflow.
- **"Strava reminds. You upload."** The connected receipt; T3b's Kept/Stops;
  the reminder copy ("New run on Strava · Add it here: upload the file,
  then what you wore"), timed by when the run landed; **one per run,
  cleared when a file with a matching start time is uploaded**; T3a's
  status line ("CONNECTED · LAST RUN SEEN …"); the auto-import toggle
  removed; T2's import-progress screen retired; DS2's header "6 RUNS · NO
  VERDICT YET".

**STR-9 · The reminder email [P]** (§4; decision D-43; round 26 #19). The
reminder consumer also sends the email, through 126's interface, when the
runner's switch (ACC-11) is on: **20 minutes after the run lands**,
**skipped if a matching file was uploaded** in the meantime, **at most one a
day**, the next one counting both ("2 runs landed on Strava yesterday and
today."). Subject "New run on Strava. Add it here.", body "A run landed on
Strava at {time}. Upload its file, then add what you wore.", button "Add
it", and the drawn footer. Round 26's "or the push was opened" does not
apply: there is no push (decision D-44). The skip rule is checked when the
email is due, not when it is queued. Carry no activity data (decision D-33). It lands after ACC-2 and ACC-11; until then, build
the in-app half and leave a named call site. Test: switch off, no email;
a redelivered reminder sends once.

**STR-10 · 7-day prune [P]** (§1.6). Strava ids in
`processed_webhook_events` and `notifications.subject` older than seven
days are deleted, from the existing daily firing (an addition to
`ops/scheduled.ts`; no new cron). Moved here from 125's scope because the
tables are this lane's. Check the dedupe window still holds: a redelivery
older than the prune window is not something Strava does, and say so in the
design doc with the source.

**STR-11 · A1's start-time correction [P]** (round 26 #1). The time on the
stats line is a button, "Change start time, 6:04 AM", opening a START TIME
row inside the parsed card with the drawn hint, a time field and **Get
weather**. While it fetches: `WEATHER FOR {t}` · `[ Getting it ]` · `WAS
{old} · AT {t0}` (in the rail at desk). Success closes the row and the
stats line reads `{t} · CHANGED`; failure shows `STILL {t0}` · "Couldn't
get weather for {t}. Try again?" and **reverts both the time and the
conditions**, so a run never carries a time whose weather we lack. The date
is fixed. A primary action pressed mid-fetch waits in brackets, then goes.

**STR-12 · R2b's sky pick [P]** (round 26 #2). Two required picks, nothing
preselected: **How warm**, the twelve 5 °C bands labelled in the runner's
unit (whole numbers) in a 3-column radiogroup, coldest top-left; **Sky**,
Dry / Damp / Rain / Snow. The button reads "Set {band} and {sky}"; the
two missing-pick messages; the badge `SET · 41–50° · RAIN`, never the
stored midpoint. The sky needs `add_manual_conditions_sky`, an additive
nullable column on `manual_conditions` in the **weather** database's
journal. Manual rows stay out of consensus and training.

**STR-13 · US date order [P]** (round 26 #9). One Intl-based formatter in
`lib/dates.ts`, month before day: mono labels "SAT AUG 29", prose "Sat, Aug
29". Replace the day-first renderings wherever they are; other lanes adopt
it in their own screens.

**STR-14 · Coordinate precision [F]** (D-110, found by PR #109). A run's
start point and the profile fallback are stored at full precision, and the
raw point goes to Visual Crossing. Decide the precision (the development
plan's default: two decimal places, about 1 km, which no weather lookup we
do can tell apart), put one rounding helper in `lib`, and round **before
storing and before sending**. Check the weather cache key still hits.
Write the reason in the design doc, and ask if you want finer. 129 uses the
helper in the city writer (FEED-5). Test: a stored run and the upstream
URL both carry the rounded value.

## Soon-after, yours

App-level encryption of `strava_connections` tokens (§7).

## Tests

Worker tests for STR-1 to STR-6 and STR-9/10 with Strava's API faked at the
fetch boundary (every call has a timeout and a zod parse, law 4). ui and
conformance tests for STR-7, STR-8, STR-11 and STR-12 (round 26's "A1 Time
correction", "R2b Set conditions", "T1/O3 Strava official button" frames). Mutation stays at 100% on
`modules/runs` and every `.tsx` you touch; remember that a changed
`runs/functions.ts` is mutated by the push gate and cannot be killed —
keep logic out of it.

## Demos

- New `e2e/strava/`: connect with the official button, the receipt, T3a's
  line, disconnect with T3b.
- `e2e/run-logging/`: A1–A3 at 1040 in two columns; A1's time correction;
  R2b's two picks.
- The reminder: a (faked) webhook event, the S1 row, the upload that clears
  it.
