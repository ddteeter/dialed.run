/**
 * The words B2's screen draws that `call/evidence`'s table does not hold:
 * each is the text of a Round 62 ruling (`design/Round 62 Rulings.dc.html`),
 * named in the comment above it. They belong in the evidence table once the
 * contract settles (QUESTIONS.md, A6).
 *
 * Mono captions are typed in sentence case and drawn in capitals by `Mono`,
 * so a screen reader says a word and does not spell one.
 */
export const SCREEN_WORDS = {
  // 366.3: the card, "NO FORECAST FOR THIS HOUR" and its sentence.
  noForecast: "No forecast for this hour",
  noForecastBody:
    "This Call comes from all your runs, not this hour's weather.",
  // 365: the caption over the why-nots.
  whyNot: "Why not",
  // 362: the line when the runner has verdicts and none counts.
  noneCounted:
    "Verdicts count on runs with conditions. Yours so far have none.",
} as const;

/**
 * 366.3: the header with no forecast, "PROBABLE · [N RUNS]", with no "IN
 * BAND". The said form drops the mark, as the evidence table's said forms
 * do.
 */
export function allRunsWords(runs: number): { shown: string; said: string } {
  const count = String(runs);
  return {
    shown: `PROBABLE · ${count} RUNS`,
    said: `Probable, ${count} runs`,
  };
}

/**
 * 365: the words of "▸ N more".
 */
export function moreWords(count: number): string {
  return `${String(count)} more`;
}

/**
 * 362: the meter's reading, "0 of 15 verdicts counted".
 */
export function countedWords(counted: number, threshold: number): string {
  return `${String(counted)} of ${String(threshold)} verdicts counted`;
}
