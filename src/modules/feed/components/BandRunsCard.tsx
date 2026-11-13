import type { JSX } from "react";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import { formatTemp, precipClassOf } from "../../../lib/contracts/temperature";
import { Mono, RailCard, Spoken } from "../../../ui";
import type { BandRun } from "../band-runs";
import { VerdictBadge } from "./VerdictBadge";

/**
 * The band history card on A2's and A3's desk rails (round 25): the
 * runner's last runs in this band, each a row of its day, its conditions
 * and its verdict, with the pieces worn as pills beneath.
 *
 * Read-only: *"Tapping a row does nothing, so 'That's it' stays the one
 * way to take a suggestion."* So the rows are text, not controls.
 *
 * The heading names the band and the run's own sky, as the board writes
 * it — `LAST 3 IN 38–46° DAMP` on A2, `BEFORE, IN 38–46° DAMP` on A3. With
 * nothing in the band yet it says so in DS2's words for the same case,
 * which A3's history line already uses.
 */
export function BandRunsCard({
  lead,
  bandFloor,
  precipMm,
  runs,
  units,
}: Readonly<{
  /**
  What comes before the band: "Before, in" on A3, "Last n in" on A2.
  */
  lead: (count: number) => string;
  bandFloor: number;
  /**
  The run's own precipitation, whose class the heading names.
  */
  precipMm: number;
  runs: readonly BandRun[];
  units: Units;
}>): JSX.Element {
  // The band is a range, said in words (round 53 #162.3): "38–46°" is
  // read as a dash, a minus or nothing. A band is five degrees Celsius
  // wide from its floor, as `bandLabel` draws it.
  const band = measuredLine(
    [
      [
        { kind: "range", minC: bandFloor, maxC: bandFloor + 5 },
        { kind: "word", word: precipClassOf(precipMm) },
      ],
    ],
    units,
  );
  const opening = lead(runs.length);
  return (
    <RailCard
      title={
        <Spoken
          shown={`${opening} ${band.shown}`}
          said={`${opening} ${band.said.charAt(0).toLowerCase()}${band.said.slice(1)}`}
        />
      }
    >
      {runs.length === 0 ? (
        <p className="m-0 text-small text-muted">No runs in this band yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {runs.map((run) => (
            <BandRunRow key={run.id} run={run} units={units} />
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function BandRunRow({
  run,
  units,
}: Readonly<{ run: BandRun; units: Units }>): JSX.Element {
  return (
    <li
      data-part="band-run"
      className="flex flex-col gap-2 border-t border-hairline py-3 first:border-t-0 first:pt-0"
    >
      <span className="flex items-center gap-3">
        <span className="text-body font-semibold">{run.day}</span>
        <Mono step="xs" className="text-muted">
          {`${formatTemp(run.conditions.tempC, units.temp)} ${precipClassOf(run.conditions.precipMm)}`}
        </Mono>
        <span className="ml-auto">
          <VerdictBadge verdict={run.verdict} />
        </span>
      </span>
      {run.pieces.length === 0 ? undefined : (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
          {run.pieces.map((piece) => (
            <li
              key={piece.itemId}
              className="rounded-pill border border-ink px-2 py-1"
            >
              <Mono step="xs">{piece.name}</Mono>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
