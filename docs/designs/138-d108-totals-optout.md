# Design: 138 D-108 opt-out, region and disclosures

> Lane A of `docs/launch/before-public-plan.md` (task 126's area, stage 1:
> before friends).

## Problem

D-108 counts private runs in published anonymous totals. The opt-out
defaults to on, so a private run logged before the setting exists would
count in totals its runner was never told about. This lane ships the
setting (D), the three in-app disclosures (E) and the optional region
(round 30 data requirement (d)) before any friend logs a run.

## Approach

- **Migration `add_profile_aggregate_prefs`** (additive, owner-approved):
  `user_profiles.count_in_totals` (integer boolean, not null, default 1),
  nullable `region_country` (ISO 3166-1 alpha-2) and `region_subdivision`
  (ISO 3166-2, e.g. `US-MN`).
- **`lib/contracts/regions.ts`**: the country list, subdivisions for the
  US and Canada (the drawn "state or province"), and `regionInput`, whose
  refinements refuse a subdivision without a country or from another
  country. Error copy lives there.
- **`onboarding/aggregate-prefs.ts`**: the one writer of each,
  `setCountInTotals` and `setRegion`. Server functions
  `setCountInTotalsFn` / `setRegionFn` use `requireUserId()`: the
  owner ruled (2026-10-11) that an unconfirmed runner may opt out and set
  a region without the confirm sheet. `currentSettings` reads all three;
  A3 reads `countInTotalsQuery`, which carries nothing else.
- **Settings › Privacy** (the `sharing` sub-page) gains the totals switch:
  saves on toggle (`useControlAction`, kicker `Not changed`), no confirm,
  drawn on/off sub-lines, and "How the guides are made".
- **Settings › Region**: a third settings section, a row under You, a
  country select and a subdivision select shown only where the country has
  some, the drawn hint, one Save. Choosing no country clears both.
- **A3**: the verdict route passes `isVerified` (from the session it
  already reads) and the switch's state. Private, the sub-line is
  onboarding's `PrivateRunLine`: unverified → round 27's line; opted in →
  the D-108 line with Change, which opens the totals switch in a sheet (the
  form's state never unmounts, so its values stay); opted out → "Only you
  see this run."
- **Au2**: one sentence appended to `AuthLegal`'s terms line.
- **`profile.csv`** gains `count_in_totals`, `region_country`,
  `region_subdivision`; `runs.csv` gains `moving_seconds` and
  `elevation_gain_meters` (R-135).

## Contract touches

- Schema: the additive migration above. Nothing reads `count_in_totals`
  yet; lane B's guide reader is its first consumer.
- New route files: none (`region` is a new `$section` value).
- New bindings/queues/crons: none.
- Screens: U1 (Privacy, Region rows), A3, Au2 per round 32
  (`design-deltas.md` "Round 32 · Anonymous totals") and round 30 (d).

## Test plan

- worker: defaults on a fresh profile; both writers (upsert, no
  collateral, clearing); `regionInput` refusals; export sheet columns.
- ui: totals switch on/off/failure band; region empty/set/cleared and
  never rendered on a profile; A3 opted in/out/unverified plus the sheet
  round trip; Au2's sentence.
- architecture: verification-class rows for both writers.

## Open questions

- "How the guides are made" links to `/privacy` until the marketing site
  owns `/how-it-works#totals` (design-deltas open queue).
- The Change sheet holds only the totals switch, not the share-default
  form: a form cannot nest inside A3's form.
