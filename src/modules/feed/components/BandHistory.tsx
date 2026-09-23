import type { JSX } from "react";

import type { Units } from "../../../lib/contracts";
import { bandLabel } from "../../../lib/temperature";
import { Mono } from "../../../ui";

/**
 * A3's line beneath the verdict row: this runner's own verdicts in the
 * run's temperature band (D-97).
 *
 * *"Five states. Your history in this band: [38–46°] · 2 cold · 7 dialed ·
 * 1 warm"* — design round 20 moved it out of the Dialed cell ("the in-band
 * count lives in the line beneath the row, never inside a cell") and the
 * reconciliation sweep found it unbuilt. The data was not: the verdict
 * route has loaded `verdictBandCounts` on every visit since the band
 * counts were written, and discarded it.
 *
 * Counts fold by sign, as the verdict hues do: both cold steps are "cold",
 * both warm steps "warm". The line states how often the runner called it,
 * not by how much.
 *
 * **At zero it says so**, in the words design gave DS2's rail for the same
 * case — "No runs in this band yet." A3's board does not draw its own zero
 * state, and inventing different words for the same fact on a mirrored
 * surface would be the drift this work exists to remove.
 *
 * The measured half is `Mono` at `md`, the mixed-case step: tokens.js makes
 * `xs` and `sm` uppercase and keeps `md` for values that sit inside prose,
 * which this does.
 */
export function BandHistory({
  counts,
  bandFloor,
  units,
}: Readonly<{
  counts: Readonly<Record<number, number>>;
  bandFloor: number;
  units: Units;
}>): JSX.Element {
  const cold = (counts[-2] ?? 0) + (counts[-1] ?? 0);
  const dialed = counts[0] ?? 0;
  const warm = (counts[1] ?? 0) + (counts[2] ?? 0);

  return (
    <p className="m-0 text-small text-muted">
      Five states.{" "}
      {cold + dialed + warm === 0 ? (
        "No runs in this band yet."
      ) : (
        <>
          Your history in this band:{" "}
          <Mono step="md">
            [{bandLabel(bandFloor, units.temp)}] · {cold} cold · {dialed}{" "}
            dialed · {warm} warm
          </Mono>
        </>
      )}
    </p>
  );
}
