---
name: plan-survey
description: Use when asked to survey dialed.run's plans against the code — where the build stands relative to the original 2026-08-30 plan, how the plan changed, and which deferred work never came back — or to re-run or refresh that survey. Fans out four read-only research agents, hand-verifies their top findings, and republishes the "dialed.run Plan vs. Build" artifact with a delta against the previous run.
---

# Plan survey

A read-only audit, run on demand. It answers four questions and publishes the
answers as one page:

1. **The original plan** — each deliverable in the root commit's task
   packets: shipped, changed by decision, partial, or not built.
2. **The journey** — phases and pivots from 2026-08-30 to today, each with
   its why.
3. **Deferred, never returned** — every deferral (register, design docs,
   packets, PR bodies, design-deltas, code markers), classified as orphaned,
   tracked, done later, or register-stale. **This is the point of the
   survey**; the others give it context.
4. **Design coverage, launch readiness, post-MVP epics.**

It edits nothing in the repo. Findings that call for a fix or a register row
are reported to the owner at the end. Making those changes is a separate task,
done only if the owner asks for it.

**Cost.** The four agents use about 700k tokens between them (the deferred
agent is the largest), plus your verification pass. Run the survey when the
owner asks, not on a schedule they haven't set up.

## Steps

### 1 · Set up, and find the previous run

- `OUT` = a new `survey-<today>/` directory in your scratchpad.
- The artifact is **"dialed.run Plan vs. Build"**, first published 2026-10-31
  at `https://claude.ai/artifact/EpGLTj7XLSmXY8WLZfiu8C`. If that link
  fails, find it with `Artifact` `action: "list"`.
- Read it (`Artifact` `action: "read"`; the result names the saved file),
  then pull its deferred list out for the stable-id step:
  `python3 -I build.py --extract <saved-page> $OUT/previous-deferred.json`.
  Keep the saved page; step 5 passes it as `--previous`.
- If there is no previous artifact, skip the extract. Drop the `<PREV>`
  sentence from brief 2, and publish without `url` in step 5.

### 2 · Fan out the four agents

The briefs are in `agents.md` (in this skill's directory). Send all four
in **one** message so they run concurrently. Then end the turn, and don't poll
them. Tell the owner in one line what is running.

### 3 · Verify before you publish

The agents report confidently, and in the 2026-10-31 run some of their claims
needed checking. Before writing anything up:

- **Re-check by hand** every `open-orphaned` item rated important or
  launch-blocker, and every new `not-built` or `partial` claim in the
  initial-plan and design results. Read the cited lines; a grep hit is not
  enough. Example: the dark-theme claim held up only after confirming that the
  dark values in `tokens.css` color the ink header, not a theme.
- Correct the JSON where an agent was wrong. Don't add a note saying it
  was wrong.
- Cross-check the results against each other. A gap the initial-plan agent
  found (a `partial` or `not-built` item with no recorded decision) that has
  no deferred item is a missing orphan. Add it to `extra_deferred` (below).
- Keep the ids of everything you re-checked for `verified`.

### 4 · Write `$OUT/narrative.json`

The template has no hardcoded findings. Every headline and every count in
prose comes from this file:

```json
{
  "as_of": "YYYY-MM-DD",
  "verified": ["PR#101-1", "plan-102"],
  "extra_deferred": [{ "...": "same shape as deferred.json items" }],
  "tldr": [
    ["good", "Where we are", "…"],
    ["warn", "What changed", "…"],
    ["bad", "Deferred and dropped", "…"],
    ["bad", "Never deployed", "…"]
  ],
  "text": {
    "asof": "Survey · as of YYYY-MM-DD · main @ <short sha>",
    "plan_h": "…",
    "journey_h": "…",
    "journey_p": "…",
    "deferred_h": "…",
    "deferred_p": "Sources: … (counts of docs/PRs actually read).",
    "design_h": "…",
    "design_p": "…",
    "launch_h": "…",
    "launch_p": "…",
    "epics_h": "…",
    "epics_p": "…",
    "changes_h": "…",
    "caveats": "…"
  }
}
```

- Each `*_h` states the finding as a sentence. Write "41 things were
  deferred and never tracked or built", not "Deferred items". Take every
  number from the JSON you just verified.
- `tldr` tones are `good`, `warn` and `bad`; the tone sets the label's color.
  Keep four cards.
- `changes_h` should name the movement, for example "Three orphans closed,
  two new ones". Leave it out on a first run, because that section only shows
  when there is a previous survey.
- Follow the user-visible writing rules: plain sentences, no em-dash asides.

### 5 · Build, check, publish

```sh
python3 -I .claude/skills/plan-survey/build.py "$OUT" "$OUT/dialed-plan-vs-build.html" --previous <saved-page>
```

- The build refuses duplicate deferred ids. Fix those at the source, because
  the delta matches items by id.
- Smoke-test the script once: extract the `<script>` body and run
  `node --check` on it.
- Publish with `Artifact`. Pass `url` set to the existing artifact so the link
  stays the same, and give a one-sentence `description`. Don't pass `icon`
  (it stays "map").

### 6 · Report

In chat, keep it short and give the link:

- what moved since the last survey (newly open, closed);
- the important orphans, with the verified ones marked;
- register rows that have gone stale;
- owner questions that have been waiting the longest.

Then offer the follow-ups (a fix, register rows, retiring stale rows) as a
question, and don't start them. If the root session's context is large
afterwards, say so (global CLAUDE.md, context hygiene).

## Files

- `agents.md`: the four agent briefs and their output shapes.
- `build.py`: assembles the page from `$OUT/*.json`. Also `--extract`.
- `template.html`: the page, in dialed.run's own palette and type, filled
  from the embedded `D`. Changing its look is a design change, so keep it in
  the brand tokens (`src/ui/tokens.css`).
