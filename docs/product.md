# dialed.run — Product Spec (v1)

What the app is, which screens ship in v1, and the brand rules every lane
renders under. The hi-fi visual truth lives in `design/*.dc.html`; this doc
maps it to the build. Divergences from those artboards are catalogued in
`docs/design-deltas.md`; the reasoning is in `docs/decisions.md`.

## Thesis

> Every run has an outfit. Log it.

A virtual wardrobe for runners: log what you wore, on which run, in which
weather. V1 is **social-first** — the closet, the log, and a reference feed.
The recommendation ("the call") is the first post-MVP epic; every v1 schema
and surface decision is recommender-ready so it lands without migrations.

Product principles (from the Brand Brief, all still binding):

1. Logging must be cheaper than remembering (pre-fill; correct, don't compose).
2. Weather is never typed by a human (auto from GPS+time; manual is a flagged
   last-resort fallback, excluded from aggregates).
3. Recommend, don't present options (call epic).
4. The feed is reference, not performance ("useful", no follower-count culture).
5. Gear talk stays honest (no commerce in v1 at all).
6. Running on the surface, sport-agnostic underneath (no run-only assumptions
   in the data model; pace-per-mile is a display concern).
7. **The closet is specific things, not categories** (D-26/D-27). A garment is
   ideally a product — "Janji Rover Half-Zip", not "a long sleeve" — because
   products behave differently and because the specific gear is what people
   share. Generic entries are scaffolding with a visible upgrade path, never
   the destination. Brand shows everywhere it exists (text, no logos/links).

## Navigation (v1)

Five tabs — the design's structure, with one v1 substitution:

| Tab    | V1 content                                                           | Screens                         |
| ------ | -------------------------------------------------------------------- | ------------------------------- |
| Feed   | Following + "Your conditions" (E2-lite consensus block)              | E1, E2-lite, D (no comments), H |
| Closet | Grid, condition filters, garment detail, add/edit                    | C, F                            |
| + Add  | Upload file / manual entry → attach kit → verdict                    | A1, A2, A2b, A3                 |
| Call   | **Teaser: the coverage ladder** — "N verdicts until your first call" | new screen (design delta)       |
| You    | Profile, notifications, settings/privacy                             | G, settings (needs design)      |

Onboarding runs once outside the tab bar: O1 (thermal level + location) →
tap-list closet seeding (P2) → **P2.5: name the pieces you actually reach
for** (brand autocomplete + model name, or paste a product link; skippable;
D-27) → "now go run" (P3). O2 (photo capture) and O4 (seed history) are
call-epic screens.

## Screen inventory → lanes

| ID     | Screen                          | V1?     | Lane      | Notes                                                                                                                       |
| ------ | ------------------------------- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| O1     | Calibrate the body              | yes     | 105       | writes thermal_level, city/lat/lng, units                                                                                   |
| O2     | Shoot the closet                | no      | call epic | vision capture                                                                                                              |
| O3     | Fill the long tail (tap-list)   | yes     | 105       | cohort-frequency list is static-per-climate v1 (curated lists, not learned); product-link extractor deferred                |
| O4     | Seed the history                | no      | call epic | bulk import cut from v1 (D-13)                                                                                              |
| O5/O6  | First call / ladder             | partial | 105       | ladder ships as the Call-tab teaser; no call                                                                                |
| A1     | Upload & auto-conditions        | yes     | 102       | + indoor flag, manual-temp fallback, dupe warning                                                                           |
| A2/A2b | Attach the kit / category sheet | yes     | 104       | pre-fill from nearest-conditions prior entry                                                                                |
| A3     | The verdict                     | yes     | 104       | 5-state + tags + per-item flags; share toggle                                                                               |
| B1/B2  | The call                        | no      | call epic |                                                                                                                             |
| C      | The closet                      | yes     | 101       | condition filters from real verdict data                                                                                    |
| D      | Post detail                     | yes¹    | 104       | ¹ no comments (D-04); "try this kit" deferred with kits                                                                     |
| E1     | Following feed                  | yes     | 104       |                                                                                                                             |
| E2     | Your conditions                 | lite    | 104       | consensus block only (D-16)                                                                                                 |
| F      | Add a garment                   | yes¹    | 101       | ¹ identity-first: brand autocomplete + name lead; link paste triggers enrichment (107); optional photo; no vision auto-read |
| —      | P2.5 upgrade step               | yes     | 105       | new (D-27); needs design                                                                                                    |
| G      | Your profile                    | yes¹    | 104       | ¹ no kits row, no calls-dialed%                                                                                             |
| H      | Someone else's profile          | yes¹    | 104       | ¹ no offset-translation block (needs cohort math)                                                                           |
| I      | Discovery                       | no      | post-MVP  | v1: username search + follow-from-posts                                                                                     |
| —      | Product enrichment (invisible)  | yes     | 107       | URL → snapshot + extraction ladder; no dedicated screen — results appear as pre-filled, editable fields                     |
| J      | Gear gaps                       | no      | post-MVP  |                                                                                                                             |

## The v1 logging loop (the product)

1. **Intake**: drop a GPX/FIT/TCX, or manual entry. Conditions auto-attach
   (design A1). Indoor runs skip conditions. Strava-connected users get a
   reminder notification when they finish a run — the retention hook.
2. **Attach the kit** (A2): pre-filled from the nearest-conditions previous
   entry ("MOST LIKELY · FROM 43° DAMP, AUG 14"); "That's it" is the whole
   interaction on a normal day. Otherwise the condition-filtered picker with
   the A2b category sheet. Optional photos (≤4). Picker chips show brand +
   model where known, category noun where generic (D-28).
3. **Verdict** (A3): one tap on the 5-point scale, optional tags, optional
   per-item flags. The "noted" confirmation shows the updated band count —
   proof the logging did something.
4. **Share**: on by default (per-entry toggle; global default in settings).
   Public entries feed E1/E2 and the consensus aggregates.

Target: under 15 seconds from file to logged verdict. Any added step must
justify itself against that number.

## System states (define once in `ui/`, use everywhere)

- **Loading**: chalk skeletons at real content dimensions. No spinners.
- **Offline**: v1 is online-required; failures surface inline with retry
  ("You're offline — dialed needs a connection to log"). No fake queueing.
- **Error**: inline at the point of failure, one retry + one escape. Own it
  plainly; no apology paragraphs, no error codes in the primary line.
- **Stale**: conditions older than 30 min show their age in mono.
- **Permissions**: location denied → manual city entry. Camera denied →
  file-picker upload. Nothing is permission-gated into uselessness.
- **Units**: set from locale at onboarding, changeable in settings. Storage
  is always metric.

## Empty states (from the Flow Map — copy is binding)

- Closet, 0 pieces: "Nothing in here yet. Add the five things you actually
  reach for — the rest can wait." Single CTA.
- Feed, 0 follows: land on Your conditions; Following shows a search prompt.
- Your conditions, no matches: "Nobody near you has logged 8° and windy yet.
  You'll be the first." (Widen the window before declaring empty.)
- Runs, 0 logged: "Drop in a GPX and we'll figure out the weather for you."
  Explain where a GPX comes from.
- Garment, 0 runs: show the attribute-estimated range with [UNTESTED],
  never an empty chart.
- Closet with generic items: quiet nudge — "5 of 8 pieces are still generic.
  Name the ones you reach for." Never a blocking prompt (D-27).

## Brand application (from the Brand Brief — binding for all UI work)

**Tokens** (`src/ui/tokens.css`):

```
--course-pink: #FF2D8A   brand, CTAs, "dialed" state
--hi-viz:      #F5FF3D   the app telling you something (call epic; sparingly in v1)
--split-teal:  #00E0C6   measured conditions, data, social counts
--night-run:   #0B0B0E   ink, hero fields, feed shell
--chalk:       #F4F3EF   surfaces, cards, reading
```

Rules: 60% ink/chalk, 30% one accent, 10% the other two; never three accents
in one viewport. Teal always means measured conditions; yellow always means
the app is telling you something; pink is brand and approval. Ink type on
accents, never chalk on pink/yellow at body sizes. Accents step back wherever
a user photo appears.

**Type**: Archivo Black for display (uppercase, ≤5 words); Archivo 400/600/800
for interface; IBM Plex Mono for every measured value (pace, distance,
weather, timestamps, wear counts) — mono is the tell that a number came from
a sensor, not a person.

**Bracket notation**: bounded, measured values wear square brackets in mono —
`[38–46°]`, `[8 OF 9]`, `[LOW CONFIDENCE]`, `[UNTESTED]`, `[INDOOR]`.
Never a garment name, username, or prose. Brackets are pink only when the
wordmark is the subject; elsewhere they inherit text color. Build `Mono` and
`Bracketed` primitives in `ui/` and use them exclusively — no ad-hoc styling
of measured values.

**Wordmark**: `[dialed.run]` lowercase always, including sentence-initial.

**Voice**: declarative, numeric when numbers help, one dry observation max.
Never a hype coach, never a fashion app, never hedging. Words we use: kit,
layer, worked, too warm, conditions, wore, reach for, dial in. Words we
don't: outfit of the day, look, style, curate, fit check, journey, unlock,
optimize. ("Outfit" itself is fine — it's in the tagline.)

**Lexicon** (UI copy; internal identifiers unchanged): the Closet, a Kit,
the Call, Verdict (way cold · a bit cold · dialed · a bit warm · way warm),
Conditions, Mileage. The reaction is **"useful"**.

## Launch posture

Dogfood privately with invited runners as soon as lanes land. Public sign-ups
open only after task 106 (trust & safety floor) merges and the dashboard-side
CSAM scanning is enabled. Launch narrow — seed one or two cities so the
conditions consensus (and later the cohort prior) has density; this is an
ops/marketing decision the code doesn't depend on.
