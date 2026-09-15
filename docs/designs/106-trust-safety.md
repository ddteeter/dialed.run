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
| **B. Workers AI VLM as judge** (`llava-1.5-7b`, `llama-3.2-11b-vision`, `moondream3.1`) | prompt a vision model to answer a safety question | no — a sentence, not a score | Workers AI neurons | `"ai"` block in `wrangler.jsonc` |
| **C. Vendor** (Hive, Sightengine, Rekognition, Vision SafeSearch) | purpose-built, commercial | yes | paid, new account | secret |

**Recommendation: A**, with B as the fallback the eval can promote.

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
  classifier/              #   adapter: openai.ts | workers-ai.ts (one dir swap)
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
Retry is a queue, because law 3 forbids a retry loop in a request handler.

The eval is `eval/photos/` — **a script, not a test**, same reasoning as
107's: it costs money, it answers a judgement, `vitest.config.ts` collects
`test/**` only. ~20 hand-picked benign running photos (flat-lay, mirror shot,
shirtless summer road, sports bra, race finish, cold-weather layers), reported
as a score distribution per category so the threshold is *read off* the results
rather than guessed. Photos are gitignored, like 107's page cache.

## Contract touches

- **Schema: 0015, additive only ⇒ HARD STOP.** New: `reports`, `review_queue`,
  `domain_denylist`, `photo_screenings`. New columns: ban columns on
  `user_profiles`; `screen_status` on `entry_photos`. **Already present, so
  less than the packet assumes**: `wardrobe_items.visibility` (placeholder,
  written by nobody) and `products.status` (`active`|`hidden`) both exist —
  this lane wires them, it does not add them. `0015` is free: `main` is at
  `0014` and neither open PR adds a migration (law 11 checked).
- **New binding ⇒ HARD STOP.** One queue (`dialed-screening` + its DLQ) for
  screening retry — `wrangler.jsonc` plus `modules/ops/queues.ts` so
  `test/bindings-conformance.test.ts` covers it. Note the test covers *queues
  and crons only*; a secret has nothing in `wrangler.jsonc` to conform to,
  which is why option A adds no binding and option B adds `"ai"`.
- **Screens**: W1 report (designed), W2 blocked runners (designed), W3 faces
  blurred (designed — see Q3). Admin review + duplicates report have no
  artboard ⇒ placeholder protocol, `docs/design-deltas.md` open queue, same PR.
- **Stacked on #71 and #72** at the owner's instruction. Merge kept both sides
  in `package.json`, `guardrails.config.json` and `docs/design-deltas.md`.

## Test plan

- `visibility-matrix.test.ts` (int) — pending/flagged/hidden/banned across both
  feed tabs, entry detail, profile, and the consensus aggregate.
- `screening-failure.test.ts` (int) — owner sees, public doesn't, retry enqueued.
- `report-threshold.test.ts` (int) — 3 *distinct* reporters auto-hide; 3 from
  one reporter do not.
- `denylist.test.ts` (int) — denylisted domain rejected at save, message shown.
- `bans.test.ts` (int) — content hidden, sessions revoked, sign-in blocked.
- `products-hidden.test.ts` (int) — drops out of autocomplete; garment falls
  back to its own text fields.
- `duplicates.test.ts` (unit) — near-identical normalized names grouped.
- `report-sheet.dom.test.tsx`, `blocked-list.dom.test.tsx`, review rows (dom).
- `modules/safety` joins `stryker.conf.json`'s `mutate` array in this PR, with
  its own CI shard in `.github/workflows/mutation.yml`.

## Open questions

1. **Classifier choice** — A, B or C above. Everything else waits on it: it
   decides whether `wrangler.jsonc` gains an `"ai"` block, and whether every
   uploaded photo leaves Cloudflare.
2. **Schema on `main` first, or on this branch?** The packet says main, but
   this lane is now stacked on two unmerged PRs, so a `main` migration is a
   third parent. Additive-only either way.
3. **W3 faces-blurred is designed for a stack we don't have.** The artboard
   specifies detection **on-device, at capture**, and its own feasibility note
   says: *"Mobile web has no equivalent worth shipping. If a browser upload
   path opens, it posts unblurred or not at all — decide that before the web
   feed does."* dialed.run **is** the browser upload path. Owner's call, not a
   reconciliation this lane can make.
4. **Blocking (W2) is designed and not in the packet's scope list.** It is a
   different mechanism from banning — mutual, quiet, per-user, with the
   "still counts in anonymous conditions" carve-out the artboard spells out.
   In or out?
5. **The artboard's stance says "no automated takedowns"; the packet says 3
   reports auto-hides.** W1's copy hides the entry *from the reporter's feed*
   straight away, which is narrower than a global hide. Which is the contract?
