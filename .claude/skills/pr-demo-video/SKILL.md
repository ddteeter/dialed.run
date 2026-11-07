---
name: pr-demo-video
description: Use when opening a PR that changes anything a user would see — a new or altered screen, and equally a screen whose behaviour changed behind an unchanged UI, such as stubbed data replaced by a real backend. Covers writing a throwaway demo spec scoped to the change, recording it with narration, and attaching the video to the PR so a reviewer can watch the feature instead of inferring it from a diff.
---

# PR demo videos

PR review is the hard gate, and it spends its attention on product correctness
against `docs/product.md` — the thing a diff shows worst. A demo video closes
that gap: a short, narrated recording of **what this PR changed**, and
nothing else.

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
   queue consumer, a cache-eviction rule, an index? **No demo.** A video of a
   queue consumer is theatre.

## The demo is a scratch spec, not the journey

Write `e2e/scratch/<what-changed>.spec.ts`. The directory is gitignored:
the spec is recorded, attached and never committed (design 180). Proof is
the committed tests' job — the journey and the rest of the table in
`.claude/rules/testing.md` §Which kind of test — and this PR updates them
as that table says, separately from the video.

**Why not re-record the feature's journey:** journeys walk a whole feature
and only grow, so a one-screen change cost minutes of video the reviewer
had to scrub through. A scratch demo opens on the changed screen and
lasts under a minute.

- **Seed straight to the state.** Sign in as the `scratch` account, which
  is new on every recording, and write the rows the screen needs with the
  helpers the specs already use (`e2e/conformance/logging-fixtures.ts`,
  `closet-seed.ts`, `withLocalDb`). Never click through screens the PR did
  not change to get there.
- **Scope it to the change.** Show the before-state only when the change is
  a difference a viewer cannot see otherwise.
- **Real `expect`s anyway.** The recording fails when what it narrates is
  not on screen, so the video cannot show something the code does not do.
- **One `test()`**, so one video.
- **Desk width (1280×720), for now.** The video frame is fixed at desk
  size, so a phone viewport records as a narrow strip on grey. Until
  design 180's step 5 sizes the frame from the recording, show a
  phone-only change by saying so in the PR; the a11y fixture already
  checks the other width on every committed spec. After step 5: record at
  the width the change shows at, and both only when it differs between
  them.
- It must pass `npm run lint` and `tsc` while it exists: flat ESLint config
  does not read `.gitignore`. It runs only when recording (`DEMO_SLOWMO`),
  never in a bare run or CI.

```ts
import { storageStateFor } from "../support/accounts";
import { expect, hydrated, scene, test } from "../support/demo";
import { seedItem, userIdOf } from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";

test.use({ storageState: storageStateFor("scratch") });

test("the closet lists what the runner owns", async ({ page }) => {
  const seeded: Seeded = {
    userId: await userIdOf("scratch"),
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  await seedItem(seeded, "Rover Half-zip", "top");

  await page.goto("/closet");
  await hydrated(page);
  await scene(page, "The closet · everything this runner owns", {
    say: "This is the closet. It lists everything this runner owns, by type.",
  });
  await expect(page.getByText("Rover Half-zip")).toBeVisible();
});
```

Weather is seeded, never stubbed: `weather_observations` is keyed
`UNIQUE(lat_r, lng_r, hour_bucket)`, so inserting an observation at the
demo's rounded lat/lng/hour makes the module hit cache and never call
Visual Crossing (`seedObservation` does this). `page.route()` cannot; the
fetch is server-side in the Worker.

### Narration

`scene(page, text, { say })` speaks a line and holds while it plays.
`text` is the caption, shown in a strip ffmpeg adds above the app, so it
never covers the top bar and never enters the page. `say` is the spoken
form. Write it the way a product owner demoing the screen would say it:
what the runner sees and why it matters, in full sentences. Without `say`,
the caption is read aloud with each `·` as a pause. Put each `scene()`
after the screen it describes has loaded, or the viewer hears it over a
blank page.

The voice is the Mac's system voice (System Settings → Accessibility →
Spoken Content), through bare `say` at 280 wpm. Rendered lines are cached
in `node_modules/.cache/demo-voice`, so the first recording of a new line
holds a little longer before it and later ones do not. macOS only, and
`ffmpeg` must be installed (Homebrew).

## Record

```bash
npm run demo -- e2e/scratch/<what-changed>.spec.ts
```

Output lands in `test-results/<test-dir>/`: the raw `video.webm`, and
`demo.mp4`, which is the one you attach. `npm run demo` runs `npm run
demo:mux` when the recording passes; run that alone to re-mux without
re-recording. Watch it before attaching.

**Record through `npm run demo`, not `playwright test --project=demo`.**
Pacing, video and the scratch directory are all opt-in, and that script is
what turns them on (`DEMO_SLOWMO`). Invoked bare, the demo project runs the
committed journeys at full speed, writes no video and skips `e2e/scratch/`.

**A fresh worktree needs three things first**, which CI's `e2e` job does
for itself (`.github/workflows/ci.yml`) and nothing does for you:

1. `npm run db:migrate:local:core && npm run db:migrate:local:weather && npm run db:migrate:local:ops`.
2. A `.dev.vars` with `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` set to
   Cloudflare's public test keys. `.dev.vars.example` has them. Without
   the site key, the widget renders nothing, and the account setup fails
   in `turnstileAnswered` on `waitForFunction: Timeout 15000ms` with no
   console error and no network request. That looks like a blocked
   `challenges.cloudflare.com`, and it was misread that way once.
3. `BETTER_AUTH_URL` on the port the demo actually uses. A `lane/<N>-*`
   branch, a `dialed-<N>` directory or `DIALED_E2E_PORT` moves it off
   3000, and Better Auth then refuses the sign-up as `Invalid origin`.

If a run fails because the port is in use, that is `reuseExistingServer:
false` doing its job — another worktree's dev server or push gate is up.
Set `DIALED_E2E_PORT` (and `BETTER_AUTH_URL` to match) rather than stopping
it.

## Attach to the PR

Attach `demo.mp4`, which the mux step has already encoded as H.264 + AAC.
Playwright's own VP8 `.webm` plays unreliably on iOS Safari, and review
here is phone-friendly by design.

Reference the local path in the PR body and let `gh` rewrite it to the
uploaded URL:

```bash
gh pr create --body-file pr-body.md --attach test-results/<dir>/demo.mp4
gh pr comment <n> --attach test-results/<dir>/demo.mp4   # updating an existing PR
```

**Requires `gh >= 2.99.0`** (`--attach` shipped 2026-09-01) and `ffmpeg`.
Check with `gh --version`; if either is missing, say so in the PR rather than
inventing an upload path. The scratch spec can stay or go after the PR
merges: it is never committed either way.

## Never record

Attachment URLs are public and unauthenticated — including from private
repos, and this repo is public anyway. Use the synthetic demo accounts and
synthetic data, never real user data, and never a screen showing a token,
key, or `.dev.vars` content.
