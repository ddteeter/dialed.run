# Design: sprint-a2 the Call's evidence lines and B2's view model

> Sprint lane A2 (cloud). Sibling lanes A1 (scorer) and A3 (replay) build on
> their own branches against the same frozen contract, `call/contract`.

## Problem

B2 shows a kit where every piece carries its evidence, a hi-viz paragraph,
a confidence header and "Why not the X?". Design 194 rules that all of it
is templates over counted facts, never generated text. This lane turns a
`CallResult` into that plain view model; no screen renders it yet (#457).

## Approach

A sub-module `src/modules/call/evidence/`, behind its own `index.ts`,
importing only `call/contract` and `lib/contracts`:

- `words.ts`: every user-facing string once, typed, each marked `board`
  (drawn copy), `said` (the spoken form of a drawn line, D-150) or `guess`.
  `fill(key, slots)` types its slots from the template text.
- `lines.ts`: one function per `EvidenceFact` kind → `{ shown, said }`, in
  the reader's unit (`bandForms`, `worksAtForms`; never its own °). A
  piece's line is its strongest fact: personal-piece, personal-flag,
  personal-band, cohort-share, estimate; first fact of the strongest kind
  that renders. No fact → `NO VERDICTS YET`. A cohort share under 5 band
  runners renders nothing (pinned to `feed`'s `MIN_RUNNERS` in a test).
- `paragraph.ts`: ≤2 sentences, only from facts in the result's own band:
  "too cold N times" from `personal-band`, or "too warm N times" when the
  kit is lighter than the warm runs' (`warm-runs.ts`, Q10), "skip the X" from the strongest
  `too_much` flag on a ranked piece the kit left out.
- `header.ts`: one header per `Confidence`; the kit verb (`WEAR THIS` /
  `PROBABLY WEAR`); below threshold, `CALL_VERDICT_THRESHOLD` − verdicts.
- `why-not.ts`: `whyNot(result, pieceId, names)` → question and answer, or
  `undefined` for a chosen piece, an id the ranking lacks, or no name.
- `view-model.ts`: `b2View(result, { unit, names, verdictsSoFar })`.

Shown forms bracket measured values (`DIALED [8 OF 9] · [38–46°]`); said
forms carry no brackets. Prose (paragraph, answers, header bodies) is
never bracketed (`docs/product.md` §Bracket notation).

## Contract touches

- Schema changes needed: **none**
- New route files: none. New bindings/queues/crons: **none**
- Screens implemented: none (view model for B2, C0a, C0b, C1b, O5)
- Shared skeleton (`call/index.ts`, `call/contract/*`), one
  `stryker.conf.json` line, `structure.generated.c4`, byte-identical
  across the A lanes.

## Test plan

All vitest `worker`, under `test/call/evidence/`:

- `lines.test.ts`: each fact kind × °F/°C; strength order; foreign-piece
  facts ignored; cohort floor at 4/5; rounding half up; plurals.
- `paragraph.test.ts`, `header.test.ts` (each `Confidence`; 0, 14, 15),
  `why-not.test.ts` (chosen, runner-up, optional group, unknown id).
- `view-model.test.ts`; `words.test.ts` (the guess list pinned; no said
  form has a bracket; every measured shown form has one).

## Issues

- Closes: none (the coordinator wires the lanes). Opens: none from a cloud
  session; QUESTIONS.md holds them for the owner round.

## Open questions

Answered by the owner on 2026-11-26 (QUESTIONS.md, issue #1104):

- Q1: guessed wording approved as v1, still marked `guess` in `words-data.ts`.
- Q2, Q3: the "why not" answers, their order, and one in every group stand.
- Q4: `CLIMATE COHORT` / `ALL RUNNERS` with the band stand.
- Q5: the followed-runners block comes from `feed` later. Q6: #401's
  receipt sentence is dropped. Q7: no kicker words in v1. Q9: the strength
  order stands.
- Q8: `verdictsSoFar` moves onto `CallResult` in the scorer's PR (the
  contract stays byte-identical here); `b2View`'s option switches to it at
  rebase.
- Q10: the warm line, "You've been too warm {times} in this band." (a
  guess), explains a change the Call made, so it shows only when warm runs
  outnumber cold ones in the band and the kit is lighter than what was worn
  on them: a group worn then is absent now, or a piece then is replaced in
  its group by one whose estimate starts at a warmer temperature (its
  `lowC` is higher; an unknown low end is not lighter). Too warm in a kit
  with nothing to shed says nothing of warmth. Otherwise the cold line
  shows as built, when any run was cold; a tie stays cold. The paragraph
  holds no measure, so its said form is its shown form.

**Proposed contract addition** (with `verdictsSoFar`, in the scorer's PR):
what was worn on the band's too-warm runs, which `personal-band` does not
carry. Until it lands it is `WarmRunsWorn` in `evidence/warm-runs.ts`, an
optional `b2View` input nothing passes, so the warm line never shows:

```ts
interface WarmRunsWorn {
  bandFloorC: number;
  worn: readonly { pieceId: string; group: UiGroup; estimate?: TempRange }[];
}
```

The scorer no longer returns `best-guess` (#1103); its header stays while
the contract lists the level.
