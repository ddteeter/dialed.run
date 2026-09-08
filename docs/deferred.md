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
| D-6 | `user_profiles.temp_unit` and `.distance_unit` **already exist** and nothing reads them, so every temperature renders in Celsius. `lane 104`'s `lib/temperature.ts` already has `formatTemp(tempC, unit)` — but all four call sites pass a hardcoded `"f"`. The work is wiring the stored preference through, not writing a formatter, and it is **not** a schema change (I said twice that it was; the columns were already there). | `lib/temperature.ts`, feed + closet temp display | ready | **After the lanes merge** (owner decision) — doing it in 101 and 104 separately would put two copies of the same function on the same shared path. |
| D-7 | The `"c" \| "f"` union is a bare string union in `lib/temperature.ts` and a column enum in the schema — two independent lists. One `z.enum` in `lib/contracts.ts` with the type derived via `z.infer`, so the validator, the type and the stored vocabulary are one thing. | `lib/temperature.ts:38` | ready | With D-6, same commit. |
| D-8 | `itemFlags[].note` is read back and displayed but the UI never sends it — the write half is missing. Either wire the input or drop the field until there is one. | `modules/feed/functions.ts`, `routes/feed/verdict.$entryId.tsx` | blocked | Decide: is a per-item note a v1 feature? |
| D-9 | Retiring a garment navigates with no confirmation — the item just vanishes from the grid. No toast primitive exists in `ui/`. Cheaper alternative: land on the closet with the retired filter applied so the item is visibly *there, marked retired*. | `routes/closet/$itemId.tsx:64` | blocked | Needs a design opinion (Motion Doctrine applies). |

## Duplication still standing

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-10 | ~~UI groups implemented twice.~~ **Done** — `uiGroups`/`uiGroupFor` live in `lib/contracts.ts`; lane 104 deletes its copy on rebase. | — | done | — |
| ~~D-10-old~~ | UI groups are implemented twice — `modules/closet/service.ts` (`computeUiGroup`) and `modules/feed/groups.ts` (`uiGroupFor`). Both derive the same table from `contracts.md`; lane 104's file header says so outright. Same concept, so they merge into `lib/`, not a case of two groupings that coincide. | both | ready | When 101 and 104 are both on main. |
| D-11 | `GarmentForm` wiring is duplicated between `routes/closet/new.tsx` and `edit.$itemId.tsx` (~12 lines). Found by jscpd, missed by the human review — and now reported by the `dupes` gate, along with a third instance in `$itemId.tsx` and an unrelated pair in `routes/runs/manual.tsx` + `new.tsx` that nothing had flagged. | `routes/closet/` | ready | Next edit to any of those files — the gate will raise it. |
| D-12 | Product brand+name normalisation is copy-pasted. Load-bearing for create-if-missing: two call sites normalising differently produce duplicate canonical rows. Wants a named function *and* a test pinning the rule. | `modules/products/service.ts:105` | ready | Before enrichment (107) uses it. |
| D-13 | `itemLabel()` (brand + name, generic fallback) exists in `ClosetGrid` and is re-implemented for alt text on the detail page. The visible label and the accessible name disagreeing is the exact drift worth preventing. | `routes/closet/$itemId.tsx:90` | ready | Any time. |
| D-14 | Performance buckets are listed as a TS union in `service.ts` and again as a zod enum in `functions.ts`. Export the enum, derive the type. **The `dupes` gate does not catch this one** and never will: the two are a restated *set*, not copied text, so no clone detector sees them. It is the standing example of why the register still needs human entries — upstream issue #41. | `modules/closet/` | ready | Any time. |
| D-24 | **The remaining integer-booleans.** `runs.indoor`, `notifications.read` (102) and `wardrobe_items.retired`/`.wind_resistant`/`.water_resistant` (101) now use drizzle `mode:"boolean"`. Still integers, still leaking `=== 1` into callers: `outfit_entries.is_public`, `user_profiles.share_default` and `.onboarding_complete`, plus anything 105-107 adds. One coordinated migration, because changing a column another lane reads breaks it with a type error that only appears after merge. | `db/schema-core.ts` | ready | With the lanes on main — one migration if done together, three if not. |
| D-25 | **Adopt `lib/copy.ts` in the auth surfaces.** `RETRY_GENERIC` is the same sentence in `modules/auth/google-button.tsx`, `routes/auth/login.tsx` and `routes/auth/signup.tsx`, which lane 102 could not touch — they are files every lane has, so editing them from one branch is a conflict for no benefit. | `modules/auth/`, `routes/auth/` | ready | Once the lanes are on main. |
| D-15 | Extension parsing is duplicated between the upload path and the parser dispatcher. Different errors on purpose; the *rule* for a valid extension is what would drift. | `modules/runs/imports.ts:34`, `parsers/index.ts:35` | ready | Any time. |

## Structural

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-16 | Notifications live inside `modules/runs`. The `kind` union is already a general notification system, and 104's follows / "found this useful" are not runs. Wants `modules/notifications/` and a top-level route before those land. | `modules/runs/notifications.ts` | ready | Before 104 adds a notification kind. Cheap now, expensive later. |
| D-17 | **Adopt the Forms & failure contract.** No longer blocked — design answered it in round 4 (`product.md` §Forms & failure, `design/Form Contract.dc.html`, reference implementation at `design/src/ui/FormField.tsx`). What remains is the port and the migration: `ui/FormField.tsx` shipping `useFormSubmit`, `FormField`, `FormStatus`, `FormErrorSummary`, `FormFailureBand`, `SubmitButton`, then every existing form moved onto them. The reference is a prototype, not droppable code — it inlines hex instead of brand tokens and carries `as any`, both of which the gates reject. Four lanes currently ship four answers to "the save failed"; the contract exists to make that one. | `ui/`, every form | ready | Before lanes 105-107 write new forms — they will otherwise mint a fifth. |
| D-18 | Brand seed is ~50 rows applied via `INSERT OR IGNORE` at runtime — data pretending to be code. Converts to a data migration with the same statements and zero behaviour change. | `modules/products/seed-brands.ts` | blocked | Needs a human to own the migration. |
| D-19 | `env.PHOTOS` now also holds imported `.fit`/`.gpx`/`.tcx` files. The local `const photos =` propagates the confusion into a place where it reads as a bug. Renaming the local is free; renaming the binding is a `wrangler.jsonc` change and only cheap while there is no production data. | `modules/runs/imports.ts:65` | blocked | Decide before first deploy, or never. |

## Design adoption — the artboards exist, the code does not

Created by the round 4 design import (2026-09-07). These are not
design questions — `docs/design-deltas.md` holds those. They are the
build work the answers produced.

| # | What | Where | Status | Trigger |
|---|---|---|---|---|
| D-30 | **The Icon Pack is imported but unused.** `ui/icons.tsx` carries 79 glyphs and exactly one renders anywhere (the notification bell). Screens use text where the pack has a glyph, which is the drift the pack exists to stop, and the longer it runs the more surfaces have to be revisited at once. Nav, action, weather, verdict, social and system glyphs are all usable today. Only the **closet grid** waits on D-33, and only for user-created garments — the tap-list already knows its own types (see D-33). | `src/ui/icons.tsx`, all screens | ready | Any surface a lane touches from now on; audited at the launch gate. |
| D-33 | **Garment `type` is landed; the surfaces that show it are not.** The owner said yes, so `garmentSchema` carries an optional per-category `type` and every tap-list entry sets one. What is still missing is anything that *uses* it: the closet grid and garment detail show no glyph, `GarmentForm` has no type selector, and every garment created before the column has `type = NULL` with no way to fill it in. Until the form offers it, only tap-list saves are typed. | `modules/closet/components/GarmentForm.tsx`, `routes/closet/` | ready | With D-30/D-31 — one PR, one demo. |
| D-34 | **Split the data tables out of `ui/icons.tsx` and `closet/tap-list.ts`.** Both are a manifest plus ~40 lines of behaviour in one file, and the manifest reads as one giant clone to any semantic detector — every row of a table has the shape of every other row. `.fallowrc.jsonc` ignores both files whole, which also stops it seeing `Icon` and `addFromTapList`. Moving the data to its own module (as `src/db/schema-*.ts` already is) narrows the ignore to the table and puts the behaviour back in scope. | `src/ui/icons.tsx`, `src/modules/closet/tap-list.ts` | ready | Next time either file is touched — D-31 for icons, D-33 for the tap-list. |
| D-38 | **Mutation testing does not work in this repo, and the reason is the Workers pool.** `stryker: "off"` was an adoption default set when there were almost no tests; with 275 the precondition has changed, so it was measured. Both runners fail: `@stryker-mutator/vitest-runner` cannot complete a dry run against `@cloudflare/vitest-pool-workers`, and the generic `command` runner reports **every** mutant as survived — 0.00 on `lib/normalize.ts`, where the same mutation applied by hand fails four assertions. That is a false reading, not a coverage verdict, and enabling it would manufacture a backlog. Also found: `.dependency-cruiser.cjs` does not exclude `.stryker-tmp/` and states it does not read `.gitignore`, so a sandbox left on disk fails the commit gate on a copied file — it needs an exclude before this is switched on. | `guardrails.config.json`, `vitest.config.ts`, `.dependency-cruiser.cjs` | blocked | A vitest project split for pure `lib/` modules, or a pool-compatible runner. |
| D-35 | **Move `dupes` from `mild` to `semantic`, and pay the backlog it surfaces.** Measured: mild finds 3 of 6 clone groups confirmed real by reading them, and the three it misses are the dangerous ones — three feed routes each hand-rolling the same session redirect, `feed/entries.ts` and `photos.ts` each hand-rolling the same run-ownership check, `feed.ts` and `profiles.ts` each building the same garment-name map. Semantic finds all six and reports 49 groups, ~17 distinct patterns, almost all in `modules/feed`. Not done with the analyzer's adoption because the gate reports clones in files a change *touches*: flipping it at the bottom of a stack makes five unrelated PRs each inherit a slice of a feed refactor. The flip and the extractions belong in one change. | `.fallowrc.jsonc`, `src/modules/feed/**` | ready | Its own PR, before lanes 105-107 add more feed surfaces. |
| D-31 | **The tab bar renders text, not glyphs.** `TAB_BAR` in `ui/icons.tsx` now resolves all five tabs to a glyph, but `ui/TabBar.tsx` still renders mono uppercase labels alone. Wiring it is small and visible, so it wants its own demo re-record rather than riding along in an unrelated PR. | `src/ui/TabBar.tsx` | ready | With D-30, or the next PR that touches the shell. |
| D-32 | **Round 4's screens are designed and unbuilt.** Manual run entry (R1/R2), the notification list and bell states (S1/S2), Strava connect/import/disconnect (T1/T2/T3) and settings/privacy (U1/U2) all shipped placeholder-faithful in PR #4 and now have real artboards. W1/W2/W3 (report, block, faces-blurred-at-capture) belong to task 106; X (desktop feed) and Y1/Y2 (shoes as their own object) are post-v1. | `design/Remaining Screens.dc.html` | ready | Before the launch gate for R/S/T/U; with task 106 for W; unscheduled for X/Y. |

## Watch — correct for now

| # | What | Where | Trigger to revisit |
|---|---|---|---|
| D-20 | Per-garment thermal estimates do not compose. Wind resistance belongs to the outermost layer and modifies the whole stack, so a merino base under a shell is modelled backwards. Nothing computes a kit-level estimate yet, so nothing is wrong on screen. | `lib/thermal.ts:86` | When anything sums garments into a kit estimate. Owned by the call epic, which replaces these tables anyway. |
| D-21 | `waterResistant` is one boolean. Waterproof vs water-resistant is a real product distinction and probably belongs to enrichment (`fabric_composition`, D-34) rather than something a user grades. | `lib/contracts.ts` | When enrichment can supply it. |
| D-26 | An API would want a **payload fingerprint** alongside `runs.idempotency_key`. Today a repeat key returns the first run regardless of what the second request asked for — right for a browser resubmitting the same form, wrong for an API client that reused a key with a different body, where the correct answer is an error rather than someone else's run. Stripe stores a request hash for exactly this. No cleanup is needed either way: the key is a column on a row we keep, not a growing side table, so it dies with the run. | `modules/runs/service.ts` | If a public API is ever offered. |
| D-27 | Orphaned entry photos. `modules/feed/photos.ts` puts to R2 then inserts the row; a failure between leaves an object under a random key that nothing references, and MEDIA has no expiry so it never ages out (unlike IMPORTS, which has 30 days). Storage rather than correctness, and it needs D1 to fail between two calls. A sweep would compare keys under an entry prefix against `entry_photos`. | `modules/feed/photos.ts` | If storage ever looks wrong, or if photo volume gets serious. |
| D-22 | Search folds ASCII case only (`COLLATE NOCASE`), so accented names still miss. Fixing it needs stored normalisation, not a collation. | `modules/feed/search.ts` | First non-ASCII display name. |
| D-23 | Conditions freshness is 2 hour-buckets ≈ 60 min, the closest expressible value. A true 30-minute window needs sub-hour cache keys. | `modules/feed/conditions.ts` | If 60 minutes proves too stale in use. |
| D-29 | Demo journeys run at full speed in CI and are only paced when recording, so the slow path is never exercised automatically. | `playwright.config.ts` | If a demo ever breaks only at recording speed. |
| D-28 | E2E runs single-worker because every spec shares one dev server and one local D1 file. Parallelism needs a database per worker, which is cheap to run (empty SQLite file; ~210ms server boot) but not free to wire: local D1 lives under the vite plugin's `persistState` path, so it means N dev servers on N ports started from a globalSetup, plus a `vite.config.ts` change. Recipe is recorded in `playwright.config.ts`. | `playwright.config.ts`, `vite.config.ts` | When the suite is slow enough that ~11s serial stops being acceptable. |
