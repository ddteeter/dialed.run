import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import type { Conditions, Units, VerdictValue } from "../../../lib/contracts";
import { verdictScale } from "../../../lib/contracts/verdicts";
import { Mono, SlowLabel, Spoken, useTappedSlow } from "../../../ui";
import { BOUND_SEPARATOR } from "../posted";
import { stripConditions } from "../strip";
import { SpokenDistance } from "./SpokenDistance";
import { UnderReview } from "./UnderReview";

/**
 * One run on a profile, the same row on G and H (R55·210): the date is
 * the link, TYPE.body 600 and underlined, and under it one MONO.sm line,
 * conditions · verdict in its colour · distance, with [UNDER REVIEW] at
 * the line's end. About 60 tall, a hairline after each row (the list
 * draws the one above the first). Nothing sits at the far right, so at
 * desk nothing ends up 500 away.
 *
 * While D is slow the date breathes and nothing else moves (round 47
 * #122, X3).
 */
export interface ProfileRun {
  entryId: string;
  day: string;
  distanceM: number;
  indoor: boolean;
  conditions: Conditions | undefined;
  verdict: number | null;
  underReview?: boolean;
}

/**
 * A verdict's word in its hue: T2's, cold pink, dialed teal, warm quiet.
 * Whole strings, so the unknown-class lint and Tailwind both see them.
 */
function verdictInk(value: VerdictValue): string {
  if (value < 0) return "font-semibold text-cold-text";
  if (value > 0) return "font-semibold text-quiet";
  return "font-semibold text-dialed-text";
}

export function RunRow({
  run,
  units,
}: Readonly<{ run: ProfileRun; units: Units }>): JSX.Element {
  const { isWaiting, onClick } = useTappedSlow();
  return (
    <li
      data-part="run-row"
      className="flex min-h-15 flex-col justify-center gap-1 border-b border-hairline py-2"
    >
      <Link
        to="/feed/entry/$entryId"
        params={{ entryId: run.entryId }}
        onClick={onClick}
        className="target inline-flex items-center self-start text-body font-semibold text-ink underline underline-offset-4"
      >
        <SlowLabel label={run.day} isWaiting={isWaiting} />
      </Link>
      <span data-part="run-meta">
        <Mono step="sm" className="text-quiet">
          <RunMeta run={run} units={units} />
        </Mono>
      </span>
    </li>
  );
}

/**
 * The line under the date. Each "·" is bound to what follows it
 * (R55·204's rule), so a wrapped line never ends on one.
 */
function RunMeta({
  run,
  units,
}: Readonly<{ run: ProfileRun; units: Units }>): JSX.Element {
  const cell = stripConditions(run.conditions, run.indoor, units);
  const verdict = verdictScale.find((step) => step.value === run.verdict);
  return (
    <>
      {cell === undefined ? undefined : (
        <>
          {cell.kind === "indoor" ? (
            <span className="text-muted">Indoor</span>
          ) : (
            <span className="text-dialed-text">
              <Spoken shown={cell.shown} said={cell.said} />
            </span>
          )}
          {BOUND_SEPARATOR}
        </>
      )}
      {verdict === undefined ? undefined : (
        <>
          <span className={verdictInk(verdict.value)}>{verdict.label}</span>
          {BOUND_SEPARATOR}
        </>
      )}
      <SpokenDistance distanceM={run.distanceM} units={units} />
      {run.underReview === true ? (
        <>
          {BOUND_SEPARATOR}
          <UnderReview />
        </>
      ) : undefined}
    </>
  );
}
