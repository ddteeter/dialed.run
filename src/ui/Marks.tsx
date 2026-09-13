import type { JSX } from "react";

/**
 * The two encoding channels design round 6 §AB settled, as the only two
 * components allowed to draw them.
 *
 * The question that decided it: *which axis has a non-hue channel it
 * actually wants?* Coverage is ordinal — none to all — and ink density
 * says that natively. Verdict is a direction around a centre, which
 * density cannot say at all. So coverage moved, and hue became verdict's
 * alone, everywhere and permanently.
 */

/**
How much is known about a band. Ordinal, and never a hue.
*/
export type CoverageLevel = "covered" | "partial" | "unknown";

const COVERAGE_FILL: Readonly<Record<CoverageLevel, string>> = {
  covered: "ink-covered",
  partial: "ink-partial",
  unknown: "ink-unknown",
};

/**
 * A coverage swatch: solid, 135° hatch, or hairline.
 *
 * **Decorative, and deliberately.** *"The counts are there so the reading
 * never depends on the swatch"* — every caller prints the level as a word
 * or a number beside this, so the mark is redundancy rather than the
 * message. A screen reader that announced "partial, partial" would be
 * reading the same fact twice.
 */
export function CoverageMark({
  level,
}: Readonly<{ level: CoverageLevel }>): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-coverage={level}
      className={`inline-block h-3 w-8 shrink-0 rounded-[2px] ${COVERAGE_FILL[level]}`}
    />
  );
}

/**
How a band was called. A direction around a centre, so hue may carry it.
*/
export type VerdictKind = "cold" | "dialed" | "warm";

/**
 * Cold left, dialed centre, warm right — under-, on-, over-dressed.
 *
 * Left-to-right because that is the order the thermometer runs in and the
 * order the scale is written in (`verdictScale`, −2 to +2).
 */
const SLOTS: readonly VerdictKind[] = ["cold", "dialed", "warm"];

const VERDICT_INK: Readonly<Record<VerdictKind, string>> = {
  cold: "bg-pink",
  dialed: "bg-teal",
  // Full-strength ink, not `text-night/30`: opacity never encodes meaning
  // (§AB rule 04), and the tint it replaced was both indistinguishable
  // from its neighbours and under-contrast.
  warm: "bg-night/70",
};

/**
 * The three-slot verdict mark: **the position of the filled slot carries
 * the meaning, and hue repeats it.**
 *
 * The row this replaces had one channel — hue, on three identical dots,
 * with warm at 30% ink. That is a three-way distinction carried by colour
 * alone, which is the same failure §Forms & failure rules out for errors,
 * and the 30% made it a contrast failure as well.
 *
 * Decorative here because every caller names the verdict in words beside
 * it. Position, hue and the word are three redundant channels; this
 * component is two of them.
 */
export function VerdictMark({
  kind,
}: Readonly<{ kind: VerdictKind }>): JSX.Element {
  return (
    <span aria-hidden="true" data-verdict={kind} className="flex gap-1">
      {SLOTS.map((slot) => (
        <span
          key={slot}
          className={`inline-block h-2 w-2 rounded-full ${
            slot === kind ? VERDICT_INK[kind] : "bg-night/15"
          }`}
        />
      ))}
    </span>
  );
}
