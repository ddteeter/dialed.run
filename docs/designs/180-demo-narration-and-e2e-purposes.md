# Design: 180 demo narration and e2e purposes

> Plan, not a lane packet: five steps, each its own PR. Owner decisions from
> the 2026-11-06 session are marked _(owner)_.

## Problem

Demo videos narrate with a caption painted into the page, which covers the
app's top bar, and which a reviewer on a phone must read rather than hear.
Every PR re-records its whole feature demo, and the "extend, don't sibling"
rule means those only grow (feed 887 lines, closet 784), so a one-screen
change costs minutes of video. Underneath that, the e2e suite serves five
purposes through one naming scheme, and the only guidance an agent sees
(`.claude/rules/testing.md`: "smoke tests … cover journeys, never a state
space") is stale and loads only after the agent has already decided to write
a test.

## Approach

**Voice.** `scene()` keeps its signature and gains an optional spoken form:
`scene(page, text, { say })`. On a recording run it renders the line with
`say -r 280 -o <cache>/<hash>.aiff "<spoken> [[slnc 400]]"`, holds for the
audio's length (`afinfo`) instead of `holdFor()`, and appends `{ text, startMs, audio }`
to a cue list beside `video.webm`. No `-v`: bare `say` speaks the system
voice from Spoken Content (a Siri voice), which `say -v '?'` never lists. That
is aperture-ally's finding (`macos/…/SpeechService.swift`, A/B 2026-09-28).
Rate 280 (≈1.4×) _(owner)_. `for_speech`-style rewrites (symbols, "D-87") live
in the pure half. Lines are cached by hash of text+rate, so a re-record only
synthesizes what changed. macOS only _(owner)_; without `say`, captions only.

**Captions leave the page.** No `html::after`. A post-record step
(`npm run demo:mux`) pads the frame with a caption strip above the 1280×720
viewport, overlays one PNG per cue (rendered by headless Chromium from
the old caption's styling and `public/fonts/ibm-plex-mono-*.woff2`) between its
start and the next, and mixes the audio with `adelay` + `amix`, out to H.264
`demo.mp4`. PNG overlays because this Homebrew ffmpeg has no `drawtext` or
`subtitles`; `pad`, `overlay`, `adelay` and `amix` are core. The caption-not-in-
DOM rule now holds by construction.

**Recordings skip the per-action a11y checks.** CI already runs them on the
same specs; in a recording they are only latency between frames.

**E2e split by purpose** _(owner: rename earns its cost)_:

| kind                | file                                     | written when                                                                                                                           | not for                                          |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| unit / dom (vitest) | `*.test.ts(x)`                           | the default: logic, state space, components                                                                                            | anything a real browser or server hop must prove |
| journey             | `*.journey.spec.ts`                      | a flow crosses the server boundary: new route, auth gate, server fn wired to a screen. Updated when the flow changes                   | edge cases, recording                            |
| edge case           | `*.spec.ts` beside a journey             | a case only a real browser shows                                                                                                       | what a dom test can reach                        |
| conformance         | `e2e/conformance/*.conformance.spec.ts`  | a screen with a board is built or changes shape                                                                                        | values (tokens etc.)                             |
| a11y                | none of its own _(owner)_                | never: it rides on every spec. Agents read the coverage report for unreached routes and review their transcript diff (`a11y-judgment`) |                                                  |
| walkthrough         | `e2e/walkthroughs/*.walkthrough.spec.ts` | a product story changes; 3–5 total, narrated, committed, run in CI as assertions                                                       | per-PR recording                                 |
| PR demo             | `e2e/scratch/` (gitignored)              | a PR changes what a user sees. Seeded straight to the state, scoped to the change, real `expect`s, never committed                     | proof: committed tests carry that                |

The table lives in `.claude/rules/testing.md`. The design-doc template's test
plan asks "which kinds, and why" and points at it, because that is where the
decision is actually made. `pr-ready` and `pr-demo-video` check it at the end.

## Steps

1. **Voice and caption strip.** `e2e/support/caption.ts` (pure: spoken
   rewrite, cue list, hold-for-audio, ffmpeg filter-graph builder),
   `demo.ts` (cue capture, `say` call, a11y off when recording),
   `scripts/demo-mux.ts` (thin: render PNGs, run ffmpeg), `npm run demo:mux`, run by `postdemo`.
   _Test:_ vitest on every pure function, 100% Stryker on `caption.ts`.
   `scene.spec.ts` is deleted: `scene()` no longer touches the page, so
   no caption can reach the DOM by construction. _Done:_ one existing
   demo (strava, which no active lane owns) recorded with voice and strip,
   audio within ~200 ms of its cue by ear, app top bar fully visible.
2. **The decision table.** `testing.md` table replacing line 37 (today's
   file names; steps 3–5 add their rows), template line, `pr-ready` check,
   and CLAUDE.md's index row says to read it when planning tests. No new
   architecture test: the route check it would make already exists in the
   coverage teardown (`judge()` in `e2e/support/a11y-coverage.ts`, "no spec
   visits it, and it is not listed"), and it is a stronger check because it
   observes a real visit. A static copy would be a second answer to the
   same question. _Done:_ a fresh agent given a sample packet picks the
   kinds the table names.
3. **PR demos go throwaway.** `e2e/scratch/` gitignored and matched by the
   `demo` project only while recording (`DEMO_SLOWMO`); `pr-demo-video`
   rewritten around it. A `scratch` demo account, signed up only when
   recording, so CI's accounts and the database its transcripts see are
   unchanged (coordinator-2's ask). _Test:_ knip, tsc and the stop gate pass
   with a scratch spec present and absent; a full CI-style e2e run leaves
   every transcript unchanged. **Pulled forward from step 5** _(owner:
   the effort merges together)_: `recordAt(size)` sizes the viewport and
   the video together, because a phone viewport in the fixed desk video
   recorded as a scaled column on grey (measured); `cues.json` carries
   the frame, so the strip and its caption (16px below 600 wide, where
   22px clamped a 40-character line) match it; and it carries `endMs`,
   because Playwright stops writing frames on a still page (3.68 s of
   video under 4.91 s of speech), so the mux clones the last frame to
   `endMs` and cuts there. _Done:_ one real PR ships with a scratch demo
   under 60 s.
4. **Rename and split journeys.** `*.demo.spec.ts` → `*.journey.spec.ts`,
   transcripts moved with them (`snapshotPathTemplate` keys on file path),
   feed/closet/moderation split into journey plus edge-case files. _Waits for
   coordinator-2's wave-2 lanes to merge._ _Test:_ full `npm run e2e` and the
   a11y coverage figure no lower than before. _Done:_ no file over ~400 lines.
5. **Walkthroughs.** Four stories _(owner, 2026-11-06)_: first run, logging
   a run and its verdict, the closet, the feed. One spec each in
   `e2e/walkthroughs/`, narrated as a product owner would demo it, with a
   spoken form per line. Each records at desk and phone _(owner)_: two
   projects, `walkthrough` (desk) and `walkthrough-phone`, match the same
   files. CI runs the desk project as assertions; the phone project runs
   only while recording, so CI pays once per story and the two widths
   never write the same transcript (`snapshotPathTemplate` keys on the
   file). Each signs up a **fresh runner** in a context the video does not
   see (the setup's sign-up, extracted from `accounts.setup.ts`), so no
   account is shared between widths or added to `DEMO_ACCOUNTS`; first run
   signs up on camera, because that is its story. Seeded straight to each
   story's start, like a scratch demo.
   _Done:_ each records cleanly and passes in CI.

Coordination: tell coordinator-2 before steps 1, 3 and 4 merge, and ask
before every push (the gate is machine-wide).

## Contract touches

- Schema changes: **none**. Bindings, secrets, queues, crons, CI workflows: **none**.
- `stryker.conf.json`: an exact-path negation for `scripts/demo-mux.ts`,
  beside the existing `e2e/support/demo.ts` one _(owner, 2026-11-06: a
  support utility, coverage not critical)_. It only spawns Chromium and
  ffmpeg; every decision it makes lives in `caption.ts`, which stays at 100%.
  The `//e2e` note in that file is updated to name it.

## Open questions

- None open. The walkthrough stories were decided 2026-11-06 (step 5).
