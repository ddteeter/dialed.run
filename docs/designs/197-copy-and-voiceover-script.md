# Design: 197 /how-it-works copy draft and the VoiceOver script (wave 6)

> Docs only. One draft for the owner to edit (#523) and one script for the
> owner to follow (#365). No page is built and no screen changes.

## Problem

`/how-it-works` is kept for the friends stage (owner, 2026-11-09, #523)
and Settings › Sharing already links to its `#totals` anchor, but the page
has no words. The VoiceOver pass (#365) is the owner's to run on a real
iPhone, and `docs/launch/voiceover-checklist.md` assumes its reader already
knows VoiceOver: it names gestures without teaching them and says what to
check without saying what the build should speak.

## Approach

- **#523, the copy.** A draft of the page's five parts, as the owner's
  answers fix them: the loop (the Call in one line, no date), the five
  verdict steps, `#totals`, "Why invite-only?" (the owner's line) and an
  FAQ on Strava and Garmin, what's private, and deleting an account. No
  cost question. Sources: `docs/product.md` (the loop, the lexicon, the
  voice), `verdictScale`, D-108 as amended by D-119, D-120 and D-133, and
  `docs/legal/privacy-policy.md`, so the page never says more than the
  policy does. The draft is **posted as a comment on #523**, not committed:
  it is the owner's wording, and nothing is page copy until they approve
  it. Once approved it becomes a Design item, which the coordinator numbers.
- **#365, the script.** A new `docs/launch/voiceover-script.md`:
  1. VoiceOver from nothing: a way out before turning it on, each gesture
     the pass uses, the rotor, the Caption Panel and Screen Curtain. The
     gestures are checked against Apple's iPhone User Guide, which the
     script links.
  2. How to read the expected speech. It comes from the screen's
     `e2e/transcripts/` file, which is Guidepup's virtual reader over
     Chromium's tree, not VoiceOver on iOS Safari. The script says so, gives
     a table of how VoiceOver usually words each role and state, and says
     that numbers and dates are masked in transcripts.
  3. What counts as a failure, with examples, and what does not.
  4. Each flow, screen by screen: what to do, what the build exposes in
     order, and what to check. Each screen names the transcript it was read
     from, and the transcript wins if the two differ.
  5. The log row, with a filled-in example.
- **Screens no transcript ends on.** A transcript is a test's final state,
  so some states have none (an open sheet, Turnstile, the tap-list). The
  script marks each one and gives the checklist's requirement instead of
  invented speech. They are listed in one issue.
- **The checklist stays** as the short form and the place the run is
  logged. It gains a pointer to the script, and its "written into
  `docs/deferred.md`" becomes "an issue", since that file is frozen.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens implemented: none

## Test plan

- `test/architecture/voiceover-script-transcripts.test.ts` (vitest,
  `worker`): every transcript path the script names exists, and the script
  names more than twenty, so it cannot pass on nothing. A renamed test
  moves its transcript; this is what notices.
- The full `npm test` on the final head, `npm run build` and
  `sanctions-check`. The e2e suite is not run: nothing under `e2e/` or
  `src/` changes.

## Issues

- Closes: none. #365 stays open until the owner's run on the first deployed
  build; #523 stays open until the copy is approved and with Design. The PR
  references both without `Closes`.
- Opens: #582, the states with no final-state transcript.

## Open questions

- **Garmin in the FAQ.** Runners cannot connect Garmin (D-149: the import
  is the owner's alone). The draft says so and points at uploading the
  watch's file. Whether to say anything about later is the owner's call,
  asked with the draft.
- **Drift**, answered by the coordinator (2026-11-10): the path test above
  is in this lane.
