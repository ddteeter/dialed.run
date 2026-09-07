---
name: pr-demo-video
description: Use when opening a PR that changes anything a user would see — a new or altered screen, and equally a screen whose behaviour changed behind an unchanged UI, such as stubbed data replaced by a real backend. Covers finding or writing the feature's demo spec, recording it, and attaching the video to the PR so a reviewer can watch the feature instead of inferring it from a diff.
---

# PR demo videos

PR review is the hard gate, and it spends its attention on product correctness
against `docs/product.md` — the thing a diff shows worst. A demo video closes
that gap. It is not a separate artifact: it is one e2e test in your feature's
suite, recorded.

## Does this PR need one?

The question is behavioural, not path-based: **would a reviewer opening the
app see something different than they would on `main`?** If yes, demo it.

The diff is a prompt for that question, never the answer to it:

```bash
git diff --name-only origin/main...HEAD | grep -E '\.tsx$|^src/ui/.*\.css$'
```

A hit means almost certainly yes.

**A miss does not mean no.** The most valuable demo in this repo is one whose
diff contains no `.tsx` at all: a screen built against stubs, now wired to a
real backend. Routes here are thin by mandate, so behaviour lives in
`modules/` — the closet finally listing real garments, conditions resolving
from a real observation instead of a fixture. Nothing changed shape;
everything a user cares about changed.

Ask in this order:

1. Does a screen now **do** something it did not before — show real data where
   it showed a stub, gain a state, let a user complete something they could
   not? **Demo it**, whatever the diff touched.
2. Did a screen only change **shape** — copy, layout, styling? **Demo it.**
   This is where a `.tsx` hit usually lands.
3. Did nothing user-visible change — a refactor rendering identical output, a
   queue consumer, a cache-eviction rule, an index? **No demo.** Re-recording
   an unchanged journey to satisfy a rule wastes your time and the
   reviewer's, and a video of a queue consumer is theatre.

Unsure? The tiebreaker is cheap: run the feature's demo and watch it. If you
cannot tell it from the recording on `main`, you did not need one.

## Find the demo that already owns your screens

Demos are organised by **feature**, not by lane — lanes are scaffolding,
features outlive them. The v1 logging loop spans lanes 102 and 104, so it is
one demo, not two halves.

Every demo spec opens with a `Covers:` header naming the `docs/product.md`
screen IDs it walks. **Those IDs are the authority; the directory name is
just a label.** Before creating a new feature directory:

```bash
grep -r "Covers:" e2e --include='*.demo.spec.ts'
```

If a screen you would cover already belongs to a demo, **extend that demo**.
Do not create a sibling. This is what stops four parallel lanes from
independently producing `feed/`, `social/`, and `following/`.

If nothing covers your screens, create `e2e/<feature>/<feature>.demo.spec.ts`.
Name it for the product feature, not your lane number.

## Writing the demo

- **Exactly one `test()` per demo spec.** One journey, one video. A second
  test records a second video beside the one the reviewer is meant to watch —
  put standalone assertions in a sibling `*.spec.ts` (see
  `e2e/auth/home.spec.ts`).
- **It must carry real assertions.** A record-only script rots silently and
  becomes a liability. If the demo stops demonstrating the feature, CI should
  say so.
- Import from `../support/demo`, not `@playwright/test` — that fixture strips
  animation so recordings capture settled frames.
- Wait on `html[data-hydrated="true"]` before driving controlled inputs;
  otherwise hydration's state reset races your fill.

### Seeding

Build state with `withLocalDb` from `e2e/support/local-db.ts`. It opens the
same local D1 the dev server reads, so you write with Drizzle and the real
schema rather than hand-rolled SQL that would bypass `src/lib/contracts.ts`.

```ts
await withLocalDb(async ({ core }) => {
  await core.insert(wardrobeItems).values(/* … */);
});
```

**Scope every write and cleanup to ids you generated.** A bare
`delete(table)` takes the developer's local data with it.

Weather is seeded, never stubbed: `weather_observations` is keyed
`UNIQUE(lat_r, lng_r, hour_bucket)`, so inserting an observation at your
demo's rounded lat/lng/hour makes the module hit cache and never call Visual
Crossing — with the real code path still running. `page.route()` cannot do
this; the fetch is server-side in the Worker.

## Record

```bash
npm run demo                       # every demo
npm run demo -- --grep "closet"    # just yours, while iterating
```

Output lands at `test-results/<test-dir>/video.webm` (gitignored). `npm run
e2e` runs the edge-case suite with no video.

If a run fails because the port is in use, that is `reuseExistingServer:
false` doing its job — another worktree's dev server is up, or the previous
run has not released the port. Wait for it rather than working around it.

## Attach to the PR

Transcode first. GitHub accepts `.webm`, but Playwright emits VP8, whose
playback on iOS Safari is unreliable — and review here is phone-friendly by
design.

```bash
ffmpeg -i test-results/<dir>/video.webm \
  -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p demo.mp4
```

Reference the local path in the PR body and let `gh` rewrite it to the
uploaded URL:

```bash
gh pr create --body-file pr-body.md --attach demo.mp4
gh pr comment <n> --attach demo.mp4   # updating an existing PR
```

**Requires `gh >= 2.99.0`** (`--attach` shipped 2026-09-01) and `ffmpeg`.
Check with `gh --version`; if either is missing, say so in the PR rather than
inventing an upload path.

## Never record

Attachment URLs are public and unauthenticated — including from private
repos, and this repo is public anyway. Use synthetic emails
(`demo-${Date.now()}@example.com`), never real user data, and never a screen
showing a token, key, or `.dev.vars` content.
