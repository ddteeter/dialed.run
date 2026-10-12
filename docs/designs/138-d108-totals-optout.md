# Design: 138 D-108 opt-out and disclosures

> Lane A of `docs/launch/before-public-plan.md` (task 126's area, stage 1:
> before friends).

## Problem

D-108 counts private runs in published anonymous totals. The opt-out
defaults to on, so a private run logged before the setting exists would
count in totals its runner was never told about. This lane ships the
setting (D) and the three in-app disclosures (E) before any friend logs a
run.

**No region setting.** Round 30 (d)'s self-declared region was built and
then dropped (owner, 2026-10-11; D-120): totals group by a climate zone
derived from each run's location and the runner's usual conditions, both
computed by the guide job, so nothing is asked of the runner.

## Approach

- **Migration `add_profile_count_in_totals`** (additive, owner-approved):
  `user_profiles.count_in_totals`, an integer boolean, not null, default 1.
- **`onboarding/aggregate-prefs.ts`**: the one writer, `setCountInTotals`,
  and the one narrow reader A3 uses, `countsInTotals`. The server function
  takes `requireUserId()`: the owner ruled (2026-10-11) that an
  unconfirmed runner may opt out without the confirm sheet. A runner with
  no profile row is counted; contracts tells the guide job to left-join
  with `COALESCE(count_in_totals, 1)`.
- **Settings › Privacy** (the `sharing` sub-page) gains the totals switch:
  saves on toggle (`useControlAction`, kicker `Not changed`), no confirm,
  drawn on/off sub-lines, and "How the guides are made".
- **A3**: the verdict route passes `isVerified` (from the session it
  already reads) and the switch's state. Private, the sub-line is
  onboarding's `PrivateRunLine`: unverified → round 27's line; opted in →
  the D-108 line with Change, which opens the totals switch in a sheet (the
  form's state never unmounts, so its values stay); opted out → "Only you
  see this run."
- **Au2**: one sentence appended to `AuthLegal`'s terms line.
- **`profile.csv`** gains `count_in_totals` (the effective value, so
  `true` with no row); `runs.csv` gains `moving_seconds` and
  `elevation_gain_meters` (R-135).

## Contract touches

- Schema: the additive migration above. Lane B's guide reader is its first
  consumer.
- New route files: none.
- New bindings/queues/crons: none.
- Screens: U1 (Privacy row), A3, Au2 per round 32 (`design-deltas.md`
  "Round 32 · Anonymous totals").

## Test plan

- worker: the default on a fresh profile; the writer (upsert, no
  collateral, an unconfirmed runner); the narrow reader; export columns.
- ui: totals switch on/off/failure band; A3 opted in/out/unverified plus
  the sheet round trip; Au2's sentence.
- architecture: verification-class rows.

## Open questions

- "How the guides are made" links to `/privacy` until the marketing site
  owns `/how-it-works#totals` (design-deltas item 59).
- The Change sheet holds only the totals switch: a form cannot nest inside
  A3's form. Design is asked before launch (item 59).
