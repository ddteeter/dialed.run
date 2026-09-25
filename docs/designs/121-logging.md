# Design: 121 Logging — A1, A2, A3, R, DS2, Strava

## Problem

Rounds 21–23 drew or ruled every state the logging flow shows. The build still
navigates away mid-upload, hides the picker behind a skeleton, lets a runner
type a temperature, and answers "nothing to note" by leaving A3. This lane
rebuilds the flow to the drawings, on task 120's shared pieces.

## Approach

- **A1** (`runs/components/UploadForm` → an in-place import card). The upload
  returns an import id and the card polls it (TanStack Query, the one polling
  fragment). Pending is the well's `[ Reading {file} ]`; done is the parsed
  card + conditions block; duplicate is a receipt with "Open that run"; parse
  failed is the well's field failure with one of three parser sentences;
  stalled (>20s) is `FormFailureBand` "Our end is slow. Your file is fine."
  and Try again re-sends the file. REPLACE returns to the well. The type/size
  rule moves to a client-safe sibling so the well can refuse a wrong file
  before sending it. `/runs/import/$id` redirects to `/runs/new`.
  `RunParseError` gains a `problem` (no track / unreadable).
- **Run-time correction**: the time on the parsed card opens a time field;
  saving moves `started_at` and re-drives weather (`weather_status` back to
  `pending` is the reconciliation marker; the hourly cron heals a gap).
- **R**: the list gets four badges and a breathing meta line, reading
  conditions through `weather`'s barrel; the empty state is drawn. Run detail
  becomes "R Run before kit": run strip, a read-only conditions block or the
  "No conditions · Set ›" row opening **R2b** (a sheet: Set conditions / Try
  again). The manual-temperature form and its input go. Manual entry lands on
  A2.
- **A2** (`feed/components/AttachKit`): the picker renders at once, unfiltered
  until the run's own conditions arrive; only most-likely waits. The run's
  GPS and time, never the device's — a new `attachContextQuery` (additions to
  `feed/entries.ts` + `functions.ts`). Kit required: "· N PIECES" in the
  header; Attach never relabels; empty press marks the picker "Pick at least
  one piece." ALL › / + CATEGORY open A2b (`Sheet`). The outfit photo moves
  here: `FileWell` + `photoBlurStep`, held until the attach returns an entry.
  Attach runs through `useControlAction` with `NOTHING ATTACHED`.
- **A3** (`VerdictForm`, `VerdictChips`, `chips.ts`): the ink run header
  (date · time in the run's zone, "6.2 AT 41°"); the photo block leaves; MORE
  leaves when Noted lands and chosen chips lose their ✕; ≥2 in-band runs to be
  "weakest"; nothing-to-note is a receipt, never navigation; chips draw at
  32px with a 44px seam target (`target-seam` utility in `ui/a11y.css`).
- **DS2**: failed rows keep place and choice with `FormFailureBand` spanning
  the row; `[ ALL LOGGED ]` when the last clears (and the router invalidates,
  so the bar's count goes); "No weather on this run." in the rail; below 1040
  one row at a time; "No usual kit here · Pick".
- **Strava**: the callback is a panel receipt; disconnect confirms (T3b);
  failures are control bands `NOT CONNECTED` / `STILL CONNECTED`; not
  configured renders nothing.

## Contract touches

- Schema changes: **none** (`runs.started_at` and `weather_status` exist).
- Routes: `runs/import.$importId` becomes a redirect. No new routes.
- Bindings/queues/crons: **none**.
- Screens: A1, A2, A2b, A3, A3b, R list, R run, R2b, DS2, T1/T3b, Strava return.

## Test plan

- `ui` (happy-dom): UploadForm per outcome (pending, done, duplicate, parse
  failed ×3, stalled + retry, replace); AttachKit (waiting, suggestion, none,
  no conditions, required kit, A2b, photo held then sent, NOTHING ATTACHED);
  VerdictForm (header, receipts, MORE gone, read-only chips); RunList badges +
  empty; RunDetail + R2b; VerdictBacklog (failed band, ALL LOGGED, rail line,
  one-at-a-time); StravaConnect (confirm, bands), StravaCallbackResult.
- `worker`: chips ≥2 rule; parser problems; run-time correction; set
  conditions; list/detail reads; attach context.
- e2e conformance: A1 (rest, parse failed, duplicate), A2 (waiting, no
  suggestion), R Run before kit, A3's three round-21 states.

## Open questions

- **R2b's "Set conditions" offers what?** The board draws the two buttons and
  the ruling says the runner "picks … never types a number". Proceeding with
  a choice list of 5° bands (stored at the band's middle, `source='manual'`);
  a run with no location cannot key an observation, so it gets Try again only.
- The time picker on A1's parsed card is undrawn; composed from `TextField`.

## Review fixes (PR #103, independent review)

- **B1 — a manual band entered the shared weather cache. Fixed, with the
  schema change the owner approved.** R2b wrote a `source='manual'` row
  keyed by `(lat_r, lng_r, hour_bucket)`, and `resolveAndAttach` treated it
  as a cache hit for any other runner at that place and hour (`manual`,
  someone else's guess, excluded from consensus, never refetched). No clean
  no-schema design existed: the table's only UNIQUE key is the cache cell,
  and `run_id` has no index.

  As built — additive, weather DB only:

  - new table `manual_conditions (run_id text PK, temp_c real NOT NULL,
set_at integer NOT NULL)` in `schema-weather.ts`;
  - migration `weather/0002_add_manual_conditions` (no weather migration is
    on `main` or in #101/#102/#104, so no collision). Its SQL also copies
    the legacy bands: `INSERT OR IGNORE INTO manual_conditions SELECT
run_id, temp_c, fetched_at FROM weather_observations WHERE
source='manual' AND run_id IS NOT NULL`. The legacy cache rows stay;
    deleting them is a later, destructive step;
  - the cache holds real observations only. `findObservationRow` skips a
    `manual` row, so `resolveAndAttach` treats one as a miss and fetches,
    and the real write upgrades it in place (`setWhere`, unchanged);
  - `recordManualObservation` links a real row already in the run's cell,
    as before, and otherwise upserts the band into `manual_conditions`
    (`upsertManualBand`) and sets `manual`;
  - **one deviation from the proposal: the band wins, not the cell.** The
    proposal read "real cell rows only, falling back to the run's own band".
    Built the other way round: a run with a band reads its band, even after
    another run later fetched real weather into the same cell. The band is
    what the runner chose for this run and its status says `manual`; letting
    a later cell row replace it would show "set by you" for weather they
    did not set, and put the run into consensus under a status that says it
    is out. `resolveAndAttach` also checks the band first, so a banded run
    that is re-driven settles as `manual` instead of fetching over it;
  - readers: `weather.manualReadingsForRuns` (by run id, primary key, in
    chunks) replaces `observationForRun`. `runs/service.conditionsFor` (list
    and detail) reads it in one batch, not per manual run.
    `feed/conditions.observationsForRuns` — which A2's attach context, A3's
    band and DS2 all read — skips `manual` cell rows and puts each run's
    band first, as a one-point span tagged `manual`, which consensus
    already excludes;
  - runs poisoned before this (status `manual`, another runner's band, no
    band of their own) are not repaired: they read as no conditions.

- **B2** — a backlog row whose run already has a kit carries it
  (`BacklogRow.kit`), shows it read-only and saves only the verdict; A2 for a
  kitted run redirects to A3 for its entry (`orOnToVerdict`).
- **S1/S2** — the time correction sends an absolute start
  (`startAtTimeOfDay`); a start already there is a no-op true. A run with no
  zone is read on the device's clock (`deviceTimeZone`; no profile zone is
  stored).
- **S3** — the photo uploads after the attach; its failure is the well's,
  Next resends it under the same key, Remove goes on without it.
- **S4** — a failed stat read after a saved verdict locks the form and lands
  "Noted" without its sentence (`feed/noted.ts` holds the decision).
- **S5** — the stall retry resends the same attempt (same key); no answer yet
  keeps polling, and failed polls count against the budget.
- **S6** — DS2's failed row uses `ControlFailureBand`, kicker "Not logged".
- **S7** — "That's it"/"Change" send only the pieces shown; `attachKit`
  refuses a retired garment on a new kit.
