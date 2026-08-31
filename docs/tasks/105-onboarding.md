# Task 105 — Onboarding & Call Teaser (starts after 101 merges)

## Goal

Install → useful in under two minutes: O1 (thermal level + location + units)
→ tap-list closet seeding → "log your next run". Plus the Call tab's
coverage-ladder teaser (D-16). Implements O1, the O3 tap-list pattern, and
design-deltas #1, #4, #5.

## You own

- `src/modules/onboarding/**`
- `src/routes/onboarding/**` and `src/routes/call/**` (teaser only)
- Settings page sections it introduces (units, share default, thermal
  recalibration) under `src/routes/onboarding/settings.tsx` — coordinate
  with 104 if a profile-side settings surface already landed; note the
  resolution in your design doc.
- Tests under `test/onboarding/**`

You consume via index.ts only: `closet` (tap-list server function + garment
model), `auth` (profile fields).

## Requirements

1. **O1 — calibrate**: the five-choice warm/cold question writing
   `thermal_level` (−2..+2) with the visible-offset copy from the design
   ("The offset is visible on purpose"); location (geolocate with manual
   city fallback — permission denial must not block); units from locale,
   editable. Two taps target.
2. **Tap-list**: climate-appropriate curated list from the closet module's
   starter data (Minneapolis gets mittens, Phoenix doesn't — rough climate
   band from latitude/typical temps is fine in v1; document the heuristic).
   Tap toggles; counter ("12 pieces — enough to start"); skip always
   available. No product-link paste (D-08).
3. **P2.5 — make them real (D-27)**: immediately after the tap-list, invite
   the user to name the 2–3 pieces they actually reach for: pick a tapped
   row → brand autocomplete + model name (closet lane's products API), or
   paste a product link (triggers 107 enrichment if merged). Fully
   skippable; copy sells the why ("the specific piece is what learns").
   Needs design — flagged in docs/design-deltas.md.
4. **Close (P3)**: "now go run" screen pointing at + Add (replaces O4/O5).
   Every step past O1 skippable; a user who bails still has a working app.
5. **Call teaser (D-16)**: the Call tab renders the coverage ladder —
   per-5°C-band verdict counts (pink covered / teal partial / grey unknown,
   per O6), "N verdicts until your first call" (N = threshold from a
   constant in contracts, default 15), and which band to log next. Reads
   entry/verdict data via the feed module's public API. States for 0
   verdicts ("logging now, calling later") through threshold reached
   ("the call is coming in an update — your data's ready"). No
   recommendation output of any kind.
6. **Re-entry**: onboarding runs once (flag on profile) but O1's question is
   reachable from settings as "recalibrate".

## Out of scope

O2 vision capture, O4 bulk import (D-13), the call itself, cohort anything,
product-spec extractor.

## Test expectations

- O1 writes profile fields; permission-denied path works.
- Tap-list creates `origin='taplist'` rows via the closet API; skip path.
- P2.5 upgrades a taplist row (brand+name linked, origin flips to manual);
  skip path leaves rows generic.
- Teaser band math: verdict counts bucket correctly; threshold copy states.
- Onboarding-complete flag gates re-entry.

## Done criteria

Design doc committed → verify + tests clean → a fresh local account reaches
"log your next run" in under two minutes with a 10+ piece closet, and the
Call tab shows an honest empty ladder.
