import type { JSX } from "react";

import { Mono } from "../../../../ui";
import type { B2Header } from "../../evidence";
import { countedLine, verdictsCounted } from "../facts";
import { SCREEN_WORDS } from "../words";

/**
 * C0b, below the verdict threshold: there is no Call yet, only the count
 * toward the first one (`design/Call Epic.dc.html`, "C0b Call tab empty").
 * The hi-viz card says how many verdicts remain, then Round 62's 362: the
 * reading "N of 15 verdicts counted", and, for a runner whose verdicts are
 * all on runs with no conditions, the line that says why none counts.
 *
 * No kit and no why-nots are drawn here, whatever the view lists: below
 * the threshold the Call ranks and offers nothing (owner, 2026-11-27,
 * #1102).
 *
 * The count is the state's headline, so it is the screen's one `h1`
 * (Accessibility Contract 04); the space between the number and its noun is
 * typed, so the heading is said "7 more verdicts". The meter's drawing is the Call tab's (K);
 * this draws its reading as a line (QUESTIONS.md, A6).
 *
 * `verdictsLogged` is every verdict the runner has given, counted or not.
 * No result carries it, so the route passes it; without it the line for
 * verdicts that do not count never shows.
 */
export function CallCount({
  header,
  verdictsLogged = 0,
}: Readonly<{
  header: Extract<B2Header, { kind: "count" }>;
  verdictsLogged?: number | undefined;
}>): JSX.Element {
  const counted = verdictsCounted(header);
  return (
    <section
      data-part="count"
      className="flex flex-col gap-3 rounded-card bg-hi-viz p-5 text-accent-ink"
    >
      <Mono step="xs">{header.title}</Mono>
      <h1 className="m-0 flex items-baseline gap-2">
        <span className="font-display text-display">
          {String(header.remaining)}
        </span>{" "}
        <span className="text-lead font-bold">{header.noun}</span>
      </h1>
      <Mono step="xs">{countedLine(counted)}</Mono>
      <NoneCounted isShown={counted === 0 && verdictsLogged > 0} />
    </section>
  );
}

/**
 * 362: "Verdicts count on runs with conditions. Yours so far have none."
 * Only for a runner with verdicts of which none counts.
 */
function NoneCounted({
  isShown,
}: Readonly<{ isShown: boolean }>): JSX.Element | undefined {
  return isShown ? (
    <p className="m-0 text-body">{SCREEN_WORDS.noneCounted}</p>
  ) : undefined;
}
