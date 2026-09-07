# Deferred register

Everything the PR #2–#5 review surfaced that was **not** fixed in the PR that
found it, and why. This exists because "flagging it for later" in a review
thread is not a plan — the thread scrolls away and the finding goes with it.

Not a backlog of ideas. Every row is a known defect, a known omission, or a
decision someone deliberately postponed, with the thing that should trigger
picking it up. Post-MVP *epics* live in `post-mvp.md`; this is pre-launch debt.

**Update this in the same commit that defers something.** A review reply
saying "flagging it" and no row here is the failure mode this file exists to
prevent.

Status: `blocked` (needs a human decision) · `ready` (decided, just not done)
· `watch` (correct for now, revisit on a named trigger).

---

## Correctness — fix before launch

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-1 | A transient network failure marks a working Strava connection `broken` and emails the user to reconnect. The `catch` is unconditional; only 400/401 on refresh is terminal. Needs a typed error at the `StravaApi` boundary *and* a product call on when repeated transient failure becomes broken. | `modules/runs/strava/oauth.ts:113` | blocked | Before Strava OAuth is enabled for real users. |
| D-2 | Manual run submission is not idempotent — a double-click or a retry creates two runs. Wants a client-generated key plus a UNIQUE column and `ON CONFLICT DO NOTHING`. | `modules/runs/components/ManualRunForm.tsx` | ready | Next schema batch. |
| D-3 | Photo resize decodes into a 128MB isolate with only a *compressed* size cap. A 10MB JPEG can decode to ~96MB. Three options in the thread; the cheapest (bound the decoded pixel budget) removes the OOM class without changing the upload contract. | `modules/closet/photos.ts:111` | blocked | Pick one before real photos. |
| D-4 | Strava webhook does two D1 round-trips before responding, against a disable-on-slow-response policy. Should enqueue and let the consumer do the lookup and dedupe. Changes the queue message shape, so it is the first real test of resilience law 9. | `modules/runs/strava/webhook.ts:52` | ready | Owner go-ahead; do it with the notification consumer in view. |
| D-5 | Weather is resolved at `startedAt` only. A 9–11am run is remembered as a 9am run, the verdict reflects the whole run, and the model learns the wrong association — this poisons the call epic's training signal rather than just displaying a wrong number. Sample start/mid/end and store the range; do **not** average, which smooths away the extremes people actually judge by. | `modules/runs/service.ts:80` | blocked | Next schema batch. Highest value item here. |

## Unfinished wiring

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-6 | `user_profiles.temp_unit` and `.distance_unit` **already exist** and nothing reads them. Every temperature renders in Celsius regardless. Needs a `formatTemp()` at the render boundary that reads the preference — no schema change, contrary to what the review threads first said. | `db/schema-core.ts`, all temp display | ready | Before anyone outside the US sees it — or before you do, since you asked for °F. |
| D-7 | The `"c" \| "f"` union is written as a bare string union in `lib/temperature.ts` and as a column enum in the schema. Should be one `z.enum` in `lib/contracts.ts` with the type derived via `z.infer`. Do it with D-6. | `lib/temperature.ts:38` | ready | With D-6. |
| D-8 | `itemFlags[].note` is read back and displayed but the UI never sends it — the write half is missing. Either wire the input or drop the field until there is one. | `modules/feed/functions.ts`, `routes/feed/verdict.$entryId.tsx` | blocked | Decide: is a per-item note a v1 feature? |
| D-9 | Retiring a garment navigates with no confirmation — the item just vanishes from the grid. No toast primitive exists in `ui/`. Cheaper alternative: land on the closet with the retired filter applied so the item is visibly *there, marked retired*. | `routes/closet/$itemId.tsx:64` | blocked | Needs a design opinion (Motion Doctrine applies). |

## Duplication still standing

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-10 | UI groups are implemented twice — `modules/closet/service.ts` (`computeUiGroup`) and `modules/feed/groups.ts` (`uiGroupFor`). Both derive the same table from `contracts.md`; lane 104's file header says so outright. Same concept, so they merge into `lib/`, not a case of two groupings that coincide. | both | ready | When 101 and 104 are both on main. |
| D-11 | `GarmentForm` wiring is duplicated between `routes/closet/new.tsx` and `edit.$itemId.tsx` (~12 lines). Found by jscpd, missed by the human review. | `routes/closet/` | ready | Any time. |
| D-12 | Product brand+name normalisation is copy-pasted. Load-bearing for create-if-missing: two call sites normalising differently produce duplicate canonical rows. Wants a named function *and* a test pinning the rule. | `modules/products/service.ts:105` | ready | Before enrichment (107) uses it. |
| D-13 | `itemLabel()` (brand + name, generic fallback) exists in `ClosetGrid` and is re-implemented for alt text on the detail page. The visible label and the accessible name disagreeing is the exact drift worth preventing. | `routes/closet/$itemId.tsx:90` | ready | Any time. |
| D-14 | Performance buckets are listed as a TS union in `service.ts` and again as a zod enum in `functions.ts`. Export the enum, derive the type. | `modules/closet/` | ready | Any time. |
| D-15 | Extension parsing is duplicated between the upload path and the parser dispatcher. Different errors on purpose; the *rule* for a valid extension is what would drift. | `modules/runs/imports.ts:34`, `parsers/index.ts:35` | ready | Any time. |

## Structural

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-16 | Notifications live inside `modules/runs`. The `kind` union is already a general notification system, and 104's follows / "found this useful" are not runs. Wants `modules/notifications/` and a top-level route before those land. | `modules/runs/notifications.ts` | ready | Before 104 adds a notification kind. Cheap now, expensive later. |
| D-17 | No form-validation strategy exists — nothing says how a form reports a failure, where the message renders, or whether client-side pre-checks exist at all. Four lanes each answered it privately, which is the auth-gate pattern repeating in the UI layer. Wants deciding once, with design input. | all forms | blocked | Next shared-surface decision. Do not let a lane invent one. |
| D-18 | Brand seed is ~50 rows applied via `INSERT OR IGNORE` at runtime — data pretending to be code. Converts to a data migration with the same statements and zero behaviour change. | `modules/products/seed-brands.ts` | blocked | Needs a human to own the migration. |
| D-19 | `env.PHOTOS` now also holds imported `.fit`/`.gpx`/`.tcx` files. The local `const photos =` propagates the confusion into a place where it reads as a bug. Renaming the local is free; renaming the binding is a `wrangler.jsonc` change and only cheap while there is no production data. | `modules/runs/imports.ts:65` | blocked | Decide before first deploy, or never. |

## Watch — correct for now

| # | What | Where | Trigger to revisit |
|---|---|---|---|
| D-20 | Per-garment thermal estimates do not compose. Wind resistance belongs to the outermost layer and modifies the whole stack, so a merino base under a shell is modelled backwards. Nothing computes a kit-level estimate yet, so nothing is wrong on screen. | `lib/thermal.ts:86` | When anything sums garments into a kit estimate. Owned by the call epic, which replaces these tables anyway. |
| D-21 | `waterResistant` is one boolean. Waterproof vs water-resistant is a real product distinction and probably belongs to enrichment (`fabric_composition`, D-34) rather than something a user grades. | `lib/contracts.ts` | When enrichment can supply it. |
| D-22 | Search folds ASCII case only (`COLLATE NOCASE`), so accented names still miss. Fixing it needs stored normalisation, not a collation. | `modules/feed/search.ts` | First non-ASCII display name. |
| D-23 | Conditions freshness is 2 hour-buckets ≈ 60 min, the closest expressible value. A true 30-minute window needs sub-hour cache keys. | `modules/feed/conditions.ts` | If 60 minutes proves too stale in use. |
| D-24 | Demo journeys run at full speed in CI and are only paced when recording, so the slow path is never exercised automatically. | `playwright.config.ts` | If a demo ever breaks only at recording speed. |
