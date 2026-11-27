/**
 * The table behind `words.ts`: every user-facing string of B2's evidence,
 * once, with where its wording comes from. Data only, split from `fill`
 * the way `closet/tap-list-data.ts` is split from its readers: every row
 * has the shape of every other, so a run of rows reads as a clone.
 */
export type WordOrigin = "board" | "said" | "guess";

export const words = {
  // ---- counts -------------------------------------------------------------
  // C0a draws "twice"; the other counts are its plurals.
  once: { origin: "guess", text: "once" },
  twice: { origin: "board", text: "twice" },
  times: { origin: "guess", text: "{count} times" },
  // C0a draws "11 RUNS IN BAND".
  runOne: { origin: "guess", text: "1 run" },
  runMany: { origin: "board", text: "{count} runs" },

  // ---- one line per piece ---------------------------------------------------
  // B2: "DIALED 8 OF 9 · 38–46°".
  pieceDialed: {
    origin: "board",
    text: "DIALED [{dialed} OF {of}] · [{band}]",
  },
  pieceDialedSaid: { origin: "said", text: "Dialed {dialed} of {of}, {band}" },
  flagTooMuch: { origin: "guess", text: "TOO MUCH [{times}] · [{band}]" },
  flagTooMuchSaid: { origin: "said", text: "Too much {times}, {band}" },
  flagNotEnough: { origin: "guess", text: "NOT ENOUGH [{times}] · [{band}]" },
  flagNotEnoughSaid: { origin: "said", text: "Not enough {times}, {band}" },
  bandRuns: { origin: "guess", text: "[{runs}] IN [{band}]" },
  bandRunsSaid: { origin: "said", text: "{runs} in {band}" },
  // O5 draws "CLIMATE COHORT · 78% AT 58°"; the contract carries a band,
  // not a temperature, so the band takes the number's place.
  cohortClimate: {
    origin: "guess",
    text: "CLIMATE COHORT · [{percent}%] AT [{band}]",
  },
  cohortClimateSaid: {
    origin: "said",
    text: "Climate cohort, {percent} percent at {band}",
  },
  cohortEveryone: {
    origin: "guess",
    text: "ALL RUNNERS · [{percent}%] AT [{band}]",
  },
  cohortEveryoneSaid: {
    origin: "said",
    text: "All runners, {percent} percent at {band}",
  },
  // Closet C's WORKS AT readout, said as `worksAtForms` says it.
  worksAt: { origin: "guess", text: "WORKS AT [{range}]" },
  worksAtSaid: { origin: "said", text: "Works at {range}" },
  // B2's evidence slot for a piece with nothing counted behind it.
  noVerdicts: { origin: "board", text: "NO VERDICTS YET" },
  noVerdictsSaid: { origin: "said", text: "No verdicts yet" },

  // ---- the hi-viz paragraph -------------------------------------------------
  // C0a: "You've been too cold twice in this band."
  coldRuns: {
    origin: "board",
    text: "You've been too cold {times} in this band.",
  },
  // The owner's warm mirror of C0a's cold sentence (Q10, 2026-11-26).
  warmRuns: {
    origin: "guess",
    text: "You've been too warm {times} in this band.",
  },
  // C0a: "Skip gloves — too much at 41° last week." The contract carries
  // a count, not a date or a temperature.
  skipPiece: {
    origin: "guess",
    text: "Skip the {name} — too much {times} in this band.",
  },

  // ---- the header ---------------------------------------------------------
  // C0a: "CONFIDENT · 11 RUNS IN BAND".
  confident: { origin: "board", text: "CONFIDENT · [{runs}] IN BAND" },
  confidentSaid: { origin: "said", text: "Confident, {runs} in band" },
  probable: { origin: "guess", text: "PROBABLE · [{runs}] IN BAND" },
  probableSaid: { origin: "said", text: "Probable, {runs} in band" },
  // C1b.
  borrowed: { origin: "board", text: "BORROWED CALL" },
  // C1b: "You've logged 0 runs above 72°. This comes from Denver runners
  // at 84°, not from you."
  borrowedInBand: {
    origin: "guess",
    text: "You've logged {runs} in {band}. This comes from {source}, not from you.",
  },
  borrowedNoBand: {
    origin: "guess",
    text: "This comes from {source}, not from you.",
  },
  // C0b: "Runners in your climate mostly go long-sleeve…".
  sourceClimate: { origin: "board", text: "runners in your climate" },
  sourceOthers: { origin: "guess", text: "other runners" },
  // O5.
  bestGuess: { origin: "board", text: "BEST GUESS" },
  // O5: "I don't know you yet. This comes from your closet, your climate,
  // and 4 runs you tagged." The contract counts no tagged runs.
  bestGuessBody: {
    origin: "guess",
    text: "I don't know you yet. This comes from your closet and your climate.",
  },
  // C0b: "UNTIL YOUR FIRST CALL · 7 · more verdicts".
  untilFirstCall: { origin: "board", text: "UNTIL YOUR FIRST CALL" },
  moreVerdictOne: { origin: "guess", text: "more verdict" },
  moreVerdictMany: { origin: "board", text: "more verdicts" },
  // C0a and B2 draw "WEAR THIS"; C1b and O5 "PROBABLY WEAR".
  wearThis: { origin: "board", text: "WEAR THIS" },
  probablyWear: { origin: "board", text: "PROBABLY WEAR" },

  // ---- why not the X ------------------------------------------------------
  // B2: "Why not the vest?". The answer is not drawn: every one is a guess.
  whyNotQuestion: { origin: "board", text: "Why not the {name}?" },
  answerFlagged: {
    origin: "guess",
    text: "You told us the {name} was too much {times} in this band.",
  },
  answerLeftOut: {
    origin: "guess",
    text: "Nothing in your verdicts says you need the {name} at this hour.",
  },
  answerRanked: {
    origin: "guess",
    text: "The {chosen} ranked higher for this hour.",
  },
  answerDialedOnly: {
    origin: "guess",
    text: "The {chosen} is dialed {dialed} of {of} in this band. The {name} has no verdicts here yet.",
  },
  answerDialedBoth: {
    origin: "guess",
    text: "The {chosen} is dialed {dialed} of {of} in this band. The {name}, {askedDialed} of {askedOf}.",
  },
} as const satisfies Record<
  string,
  { readonly origin: WordOrigin; readonly text: string }
>;
