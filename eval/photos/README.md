# The photo-screening eval

**Nothing has been evaluated yet. No photo in `corpus-data.ts` has ever
been sent to the classifier.** Asked directly on PR #73, and that is the
honest answer — so it is written here rather than left to be inferred from
an empty directory.

## What exists and what does not

| | state |
| --- | --- |
| The harness (`run.ts`, `report.ts`, `corpus.ts`) | **built**, and covered by tests |
| The corpus **table** — 20 entries, each with the file name it expects and the label it should get | **written** (`corpus-data.ts`) |
| The corpus **photos** themselves | **do not exist.** `eval/photos/corpus/` is gitignored and empty |
| A run against a real model | **has never happened** |

So `corpus-data.ts` is a *specification of photos to gather*, not a record
of photos that were tested. Every row is a claim about what the classifier
*should* say, written from the packet's reasoning about where the
interesting boundaries are — bare arms, a sports bra, a race singlet — and
none of them has been checked against the model.

## What that means for the thresholds

`thresholds` and `reviewFloors` in
`src/modules/safety/classifier/moderation.ts` are **unmeasured**. Their
doc comments say "provisional until `npm run eval:photos` has run", and
that remains literally true. They are argued-for starting points: set high
because the documented failure of this model is over-sensitivity on
ordinary running kit. They are not results.

This is why the middle review band exists at all (owner's call, PR #73). A
reviewer agreeing or disagreeing with a borderline score is calibration
from photos real runners posted, which is the one signal this eval cannot
produce — because the eval only ever sees photos we chose.

## To actually run it

1. Put 20 photos in `eval/photos/corpus/`, named exactly as
   `corpus-data.ts` lists them. Use photos you have the right to use;
   they are sent to a third-party API.
2. Set `OPENAI_API_KEY` in `.dev.vars`.
3. `npm run eval:photos`.

Then move the thresholds to what the numbers say, and delete the word
"provisional" from both.
