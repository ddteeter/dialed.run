# Design: 106 Trust & Safety Floor

**LAUNCH GATE. This doc is a hard stop** — schema and classifier choice both
need an answer before implementation starts (packet §Done criteria).

## Problem

Public sign-ups don't open until a stranger's photo, a stranger's product name
and a stranger's link can all be dealt with by one person in under a day. The
floor is: screen photos before strangers see them, let anyone report anything,
hide on report, review in one place, and ban when it comes to that. Comments
don't exist (D-04), so there is no text firehose to moderate.

## The packet's classifier premise is false

The packet says "classify via a Workers AI image-classification model."
**Workers AI has one image-classification model — `resnet-50`** — and it
answers ImageNet's 1000 classes (dog breeds, vehicles, instruments). It cannot
answer a safety question. `llama-guard-3-8b` is text-only. There is no NSFW or
content-safety image classifier in the Workers AI catalogue.

Three real shapes, measured against what this lane actually needs (a *tunable*
answer, because the packet's own worry is false positives on sports imagery):

| | what it is | threshold tunable | cost | binding |
| --- | --- | --- | --- | --- |
| **A. OpenAI `omni-moderation-latest`** | purpose-built multimodal moderation classifier | **yes** — `category_scores` 0–1 per category | free, images ≤20 MB | a *secret*, not a wrangler binding |
| **B. VLM as judge** (`llava-1.5-7b`, `llama-3.2-11b-vision`, `moondream3.1`) | prompt a vision model to answer a safety question | no — a sentence, not a score | Workers AI neurons, or tokens via 107's OpenRouter key | `"ai"` block in `wrangler.jsonc` — **or none**, if it goes through the OpenRouter key 107 already added |
| **C. Vendor** (Hive, Sightengine, Rekognition, Vision SafeSearch) | purpose-built, commercial | yes | paid, new account | secret |

**Recommendation: A**, with B as the fallback the eval can promote. Note B does
not have to mean Workers AI: 107 already ships an `OPENROUTER_API_KEY` and
OpenRouter serves vision models, so a VLM judge can reach production with no
new secret *and* no `wrangler.jsonc` edit. That makes B cheap to *try* — which
is an argument for the eval measuring both, not for skipping A.

Why A, in this lane's terms. It is the only one of the three that gives a
*number per category*, and a number is what the packet's pre-launch eval exists
to tune — a VLM that answers "this looks like a person running" leaves nothing
to turn. Its image categories are `sexual`, `violence`, `violence/graphic`,
`self-harm{,/intent,/instructions}`; `harassment`, `hate`, `illicit` and
**`sexual/minors` are text-only**, so images of minors are *not* covered by it
— that gap is exactly what Cloudflare's CSAM scanning tool (packet §Explicitly
configured outside this lane) covers, and the two are complements, not
alternatives. It also removes a forbidden-zone edit: a secret follows lane
107's `FIRECRAWL_API_KEY` / `OPENROUTER_API_KEY` pattern (`env.d.ts` +
`wrangler secret put`), so `wrangler.jsonc` never changes for the classifier.

Two things A costs, stated plainly. It is a **third party seeing every uploaded
photo** — retained up to 30 days for abuse monitoring, not trained on by
default; if that is not acceptable the answer is B and the eval decides how
much accuracy that costs. And `omni-moderation-latest` is **documented as
over-sensitive**, with revealing swimwear/underwear explicitly inside the
`sexual` category — which is the packet's feared failure mode, arriving on
schedule. Hence the eval, and hence a per-category threshold rather than the
model's own `flagged` boolean.

## Approach

```
modules/safety/            # new module — owns screening, reports, review, bans
  screening.ts             #   classify(bytes) -> {scores, decision}
  classifier/              #   adapter: openai.ts (vlm.ts is the eval's comparison)
  blur/                    #   W3: lazy-loaded wasm detector + canvas tap-to-blur
  reports.ts  review.ts  bans.ts  denylist.ts  duplicates.ts
  components/              #   report sheet (W1), review rows, blocked list (W2)
  inputs.ts  functions.ts
routes/safety/             # /safety/review (admin), /safety/blocked
eval/photos/               # the pre-launch eval — reuses 107's eval/ pattern
```

Screening rides the **existing** upload path (`feed/photos.ts`,
`closet/photos.ts`): bytes land in R2 first, classify second, visibility third.
Fail open for the owner / closed for the public is a **column, not a branch** —
`screen_status` in (`pending`,`pass`,`flagged`,`error`); the owner's own reads
ignore it, every public read requires `pass`. A classifier outage therefore
degrades to "nobody else sees it yet", never to a wrong verdict and never to a
failed save (law 5, and lane 107's lesson: a wrong answer is worse than none).
Retry is the hourly `screening-retry` cron re-driving anything still
`pending`, not a queue — law 3 forbids retrying inside the request handler,
and law 8c prefers reconciliation wherever a durable marker already exists.

The eval is `eval/photos/` — **a script, not a test**, same reasoning as
107's: it costs money, it answers a judgement, `vitest.config.ts` collects
`test/**` only. ~20 hand-picked benign running photos (flat-lay, mirror shot,
shirtless summer road, sports bra, race finish, cold-weather layers), reported
as a score distribution per category so the threshold is *read off* the results
rather than guessed. Photos are gitignored, like 107's page cache.

## Contract touches

- **Schema: `0015_trust_and_safety_floor`, additive only, on this branch**
  (Decision 2). Generated and read before trusting it, per CLAUDE.md: it is
  all `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, **no table rebuild**, so
  the `display_name COLLATE NOCASE` hazard that a rebuild would trip is not
  in play. Typing `wardrobe_items.visibility` emitted no SQL at all —
  drizzle's text enum is type-level and carries no CHECK — which is how a
  placeholder column gets narrowed without a rebuild.

  One deploy consequence worth stating rather than discovering: because
  `entry_photos.screen_status` is `NOT NULL DEFAULT 'pending'`, **every
  photo that already exists becomes publicly invisible on deploy** until the
  `screening-retry` sweep reaches it (within the hour). That is the correct
  default — 'pending' means "closed for the public" by design — and
  pre-launch it costs nothing. It would need a backfill if this shipped to a
  live feed. New: `reports`,
  `review_queue`, `domain_denylist`, `photo_screenings`, `blocks`. New columns:
  ban columns on `user_profiles`; `screen_status` on `entry_photos`. **Already present, so
  less than the packet assumes**: `wardrobe_items.visibility` (placeholder,
  written by nobody) and `products.status` (`active`|`hidden`) both exist —
  this lane wires them, it does not add them. `0015` is free: `main` is at
  `0014` and neither open PR adds a migration (law 11 checked).
- **New binding ⇒ STILL A HARD STOP, and the only one left — but smaller than
  first written.** Decision 1 removed the classifier's binding. Screening retry
  still needs one, and the first draft of this doc reached for a queue
  (`dialed-screening` + a DLQ). That is over-engineering by law 8c's own test:
  a queue is for when nothing durable says "not finished", and here
  `screen_status='pending'` *is* that marker. `weather-retry` is the same
  shape already in the tree — `runs.weather_status='pending'` re-driven by an
  hourly cron — and 8c says reconciliation is "cheapest, and always preferred
  when the marker exists". So: **one cron, not a queue.** The ask against
  `wrangler.jsonc` is a single schedule string rather than a producer, a
  consumer and a dead-letter queue, and `modules/ops/crons.ts` gains
  `{ schedule: "15 * * * *", name: "screening-retry" }` so
  `test/bindings-conformance.test.ts` covers it. Quarter past, since the
  registry's comment keeps the hourly sweeps off each other's firings.
- **Screens**: W1 report, W2 blocked runners and W3 faces-blurred are all
  designed and all in scope (Decisions 3 and 4). Admin review + the duplicates
  report have no artboard ⇒ placeholder protocol, `docs/design-deltas.md` open
  queue, same PR. W3's delivery differs from the artboard's assumed stack, so
  it gets a design-deltas row of its own.
- **Stacked on #71 and #72** at the owner's instruction. Merge kept both sides
  in `package.json`, `guardrails.config.json` and `docs/design-deltas.md`.

## Test plan

- `visibility-matrix.test.ts` (int) — pending/flagged/hidden/banned across both
  feed tabs, entry detail, profile, and the consensus aggregate.
- `screening-failure.test.ts` (int) — owner sees, public doesn't, the row
  stays `pending`, and the next `screening-retry` firing clears it.
- `report-threshold.test.ts` (int) — 3 *distinct* reporters auto-hide; 3 from
  one reporter do not.
- `denylist.test.ts` (int) — denylisted domain rejected at save, message shown.
- `bans.test.ts` (int) — content hidden, sessions revoked, sign-in blocked.
- `products-hidden.test.ts` (int) — drops out of autocomplete; garment falls
  back to its own text fields.
- `duplicates.test.ts` (unit) — near-identical normalized names grouped.
- `blocks.test.ts` (int) — a block hides both directions across feed, search
  and profile, and does **not** remove the blocked user's verdict from the
  anonymous conditions aggregate (the carve-out W2's copy promises).
- `blur.dom.test.tsx` (dom) — detected face blurred by default; tap adds one;
  "No face found" when the detector returns none; upload still works when the
  wasm fails to load (law 5).
- `blur-detect.browser.test.ts` (**browser**) — the real MediaPipe model, in a
  real Chromium. See "A third vitest project" below.
- `report-sheet.dom.test.tsx`, `blocked-list.dom.test.tsx`, review rows (dom).
- `modules/safety` joins `stryker.conf.json`'s `mutate` array in this PR, with
  its own CI shard in `.github/workflows/mutation.yml`.

## Decisions (owner, 2026-09-15)

1. **Classifier: OpenAI `omni-moderation-latest`** (option A). So: an
   `OPENAI_API_KEY` secret in `env.d.ts` + `wrangler secret put`, no `"ai"`
   block, and `wrangler.jsonc` untouched *by the classifier*. The eval still
   measures a VLM judge through 107's OpenRouter key as the comparison,
   because "the purpose-built one is better" should be a measurement.
2. **Migration 0015 lands on this branch**, not on `main` — a `main` migration
   would be a third parent on a branch already carrying two. Additive only.
3. **W3 faces-blurred: in-browser detection via WASM**, on by default. This is
   the most expensive of the three answers and the only one that honours the
   artboard, so §W3 below records how it stays inside the client-bundle rules.
4. **Blocking (W2) is in scope**, with W1's "Block them as well" checkbox live.
5. **Auto-hide is both halves.** Reporting hides the entry for the reporter
   immediately — W1's promise that filing costs them nothing — *and* three
   reports from distinct users flips it to `hidden_pending_review` globally.
   Read against the artboard's "no automated takedowns": nothing is removed
   or counted against anyone, it is queued for the person the stance promises.
6. **Admin is an `ADMIN_USER_IDS` secret**, parsed in `src/env` and checked by
   one gate in `modules/safety` beside `requireUserId` — one gate per concern,
   no migration. Changing the list is a deploy, which for a solo operator is
   the right trade.

## W3: face blur on a stack the design didn't plan for

The artboard's promise is *"detection runs on-device, so the unblurred frame
never leaves the phone"*. On the web that means the model runs in the browser
and only the blurred canvas is uploaded — the promise survives, the delivery
changes. Three constraints this lane has to respect while doing it:

- **The bundle.** A detector is hundreds of KB of wasm. It must never enter
  the client entry chunk: dynamic `import()` at the moment the file picker
  returns, never at module scope (CLAUDE.md's "construct on first use"), and
  `npm run check:bundle` gains a marker for it so a regression is loud.
- **Recall is not a promise.** The artboard is deliberate that copy says *"We
  blurred one face"* and *"No face found"*, never "faces are blurred". The
  manual tap-to-blur is not a nicety, it is what makes the honest wording
  true, and it ships in the same PR.
- **Degrade, don't fail** (law 5). If the wasm fails to load, the tap-to-blur
  path still works and the upload still works. A detector outage must not
  block someone's own logging any more than a classifier outage does.

## A third vitest project, and why it is vitest and not Playwright

**For most of this lane the 11 MB of WASM had never executed once**, and the
suite was green the whole time: every test of `blur/detect.ts` injects a fake
detector, which proves the plumbing and proves nothing about MediaPipe. Three
things blocked running it — workerd has no DOM, happy-dom refuses to execute a
fetched script (`"JavaScript file loading is disabled"`), and neither has an
HTTP origin for `FilesetResolver.forVisionTasks` to fetch from.

The obvious fix was a Playwright spec, and it is the wrong instrument for half
the problem. **Stryker runs vitest** (`testRunner: "vitest"`), so `e2e/` is
invisible to it: a spec there demonstrates the model and kills zero mutants,
while 8 of `detect.ts`'s 16 survivors lived in code only a loaded model
reaches. Measured, not assumed — `--mutate detect.ts` read 80.95% before any
of this.

So: a `browser` project in `vitest.config.ts`, real Chromium via
`@vitest/browser-playwright`, vitest's own vite server serving `public/` so
`/mediapipe/wasm` resolves exactly as in production. It is vitest, so stryker
drives it like any other project — confirmed rather than hoped, since
stryker signals the active mutant through `process.env` and the workers pool
needed that forwarded as a binding to work at all. One browser test took
`detect.ts` from 80.95% to 90.36%; the file is now at **100%**.

Three of the eight closed by deleting code rather than by asserting it:

- `buildModelDetector`'s own `try/catch` was a second way to say what
  `detectFaces` already says (law 5, one answer: `unavailable`). Removing it
  removed the equivalent mutant that emptied it — and `absent`, the refusing
  detector that existed only to turn its `undefined` back into a rejection,
  went with it.
- `runningMode: "IMAGE"` is MediaPipe's default, and the mutant that emptied
  the string detected the same faces. An unobservable claim is worse than a
  default the browser test pins.
- The memo was a keyed `Map`, and `set("face", …)` runs **once per process** —
  so under per-test coverage only whichever test ran first was recorded as
  reaching it, and the test written to assert the memo never covered the line.
  A `??=` on a holder object executes on every call.

One survivor was a real defect the comment beside it denied: `boxesFrom` said
the `typeof` on width and height was redundant because `> 0` is false for a
string. `"5" > 0` is `true`.

**The fixture is drawn, not photographed.** A committed photo of a face would
be a picture of a real person in a repo that exists to keep pictures of real
people private. The model finds a canvas-drawn face at `{56, 69, 142x142}`,
which is reviewable as code and cannot drift.

**CI needs one line, in a forbidden zone.** `.github/workflows/ci.yml`'s unit
job and `mutation.yml`'s shards both run without a browser; the e2e job
already installs one (`ci.yml:63`). Both need
`npx playwright install --with-deps chromium` after `npm ci`. Owner's, not
mine.

## Build status

Written down because this lane is large and a reviewer should not have to
infer what is finished from a diff.

**Landed.** Migration `0015`. `modules/safety`: reports with the
distinct-reporter threshold, the review queue with claim-then-resolve,
blocks, the link denylist, the admin gate, ban mechanics, the moderation
classifier and its threshold rule, the screening path, and the
`screening-retry` reconciliation sweep. `publiclyVisibleEntry()` wired
into all five feed reads that show entries to strangers. Screening wired
into both upload paths. `screening-retry` registered in `wrangler.jsonc`
(owner's edit, authorised 2026-09-15) and `modules/ops/crons.ts`, covered
by `bindings-conformance`. Review-queue depth in the daily digest.
`lib/sql-null.ts` and `lib/keyed-read.ts`'s `columnSetAmong`, both at 100%.
`eval/photos/` ready to run.

**Waiting on the owner.** `OPENAI_API_KEY` in `.dev.vars`, so the eval can
run. Until then the app is correct and safe — every photo stays `pending`,
owners see their own, the public sees none, and the first sweep after the
key exists screens the backlog. What is missing is the *measurement*, and
the packet makes that a launch gate.

**Still to build.** W1 report sheet, W2 blocked-runners list, W3
faces-blurred; their routes; the admin review page and the duplicates
report (D-30); link hygiene rendering (`rel="ugc nofollow noopener"` plus
the bare domain beside the link text); the demo video; `modules/safety`
joining `stryker.conf.json`'s `mutate` array.

## Open questions

None outstanding. All six answered by the owner on 2026-09-15 and recorded
above. One item is **blocked on the owner's own edit**: `wrangler.jsonc`
`triggers.crons` needs `"15 * * * *"` added beside the three already there,
which is a forbidden zone. `test/bindings-conformance.test.ts` fails red until
it lands, and that is the intended behaviour, not a bug to work around.
