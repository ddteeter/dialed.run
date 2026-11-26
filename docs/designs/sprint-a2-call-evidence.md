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
  "too cold N times" from `personal-band`, "skip the X" from the strongest
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

## Open questions (guesses this branch proceeds on; QUESTIONS.md has each)

1. Every "why not" answer is a guess; the board draws only the question.
2. Which pieces get a "why not": the best runner-up in each chosen group,
   plus the best piece of each group the kit left out.
3. Cohort source naming: `CLIMATE COHORT` for zone rungs, `ALL RUNNERS`
   for `everyone`; the board's "DENVER COHORT" needs a zone's place name.
4. B2's "RUNNERS YOU FOLLOW" block is feed consensus: out of scope.
5. #401's receipt sentence: needs a flag fact tied to a threshold; skipped.
6. "EASY TO SHED" / "CHEAP INSURANCE" have no fact kind; not rendered.
7. The below-threshold count needs total verdicts, which `CallResult` does
   not carry: `b2View` takes `verdictsSoFar`.
8. Strength order within personal facts (piece, flag, band).
9. Paragraph: cold only (no "too warm" mirror); the board's "the half-zip
   fixes it" needs a fact naming the fix, so it is not written.
10. The said forms and every pluralised or generalised template.
