# Task 090 — Recommendation Validation Study (PARALLEL, NON-BLOCKING — D-02)

Not a code lane. Runs alongside anything, ideally early. Output feeds the
call epic (200), not v1.

## Goal

Answer the design's warning before the engine gets built: can a human (or a
simple structured model) with full data beat a generic dressing chart? If
not, no amount of app solves it.

## Method (from the Flow Map, adapted)

1. Recruit ~10–20 runners (the dogfood group works). For each: their closet
   (using the v1 garment model: category, layer, weight, fabric, wind/water),
   thermal self-report (O1 question), and their last ~10 runs with conditions
   and what they wore, plus a would-repeat/too-warm/too-cold recall verdict.
2. Hold out 3 runs per runner. Generate a "call" for each held-out run three
   ways: (a) a generic dressing chart, (b) hand-crafted from that runner's
   own remaining data, (c) the blended-prior sketch in docs/post-mvp.md §200,
   computed in a spreadsheet/notebook.
3. Score each against what was actually worn + the recall verdict. Report
   hit rates and, more usefully, WHERE each approach fails (temp bands,
   humidity, effort).

## Deliverable

A short memo in `docs/research/090-validation.md`: hit rates, failure modes,
and a recommendation — which prior components earn their complexity, what
the confidence thresholds should roughly be, and whether 5-state verdicts
add signal over 3-state in practice. Include the raw spreadsheet.

## Non-goals

No product code. No schema changes. If findings contradict a v1 decision
(e.g. an attribute that turns out to matter isn't captured), file it as a
proposed decision-log amendment, don't change anything.
