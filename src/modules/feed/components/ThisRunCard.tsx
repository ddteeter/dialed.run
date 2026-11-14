import type { JSX } from "react";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import { precipClassOf } from "../../../lib/contracts/temperature";
import { dayLabel, viewerClockLabel } from "../../../lib/dates";
import { Mono, RailCard, Spoken, WeatherAttribution } from "../../../ui";
import type { Conditions } from "../conditions";
import { isProvidersReading } from "../strip";

/**
 * The desk rail's first card on A2 and A3 (round 25; Round 55 · 242: "A2's
 * This run card matches A3's"): the run, when it started, how far and how
 * long, and the conditions it was run in. One component, so the two steps
 * of one flow cannot describe the same run two ways.
 *
 * The day and time read on the run's clock, `clockZone`: on A2 the run
 * summary's (the run's own zone, else its runner's home zone), on A3 the
 * run's own zone alone. A time read on UTC says so, as the runs list's
 * does — an unmarked UTC time is never printed (P2a-02).
 */
export function ThisRunCard({
  run,
  units,
}: Readonly<{
  run: {
    startedAt: number;
    distanceM: number;
    durationS: number;
    clockZone: string | undefined;
    conditions: Conditions | undefined;
  };
  units: Units;
}>): JSX.Element {
  const { conditions, clockZone } = run;
  // `homeZone` is the clock's name in `lib/dates`; here it is the run's,
  // which `runs/run-clock.ts` reads the same way.
  const clock = viewerClockLabel(run.startedAt, { homeZone: clockZone });
  return (
    <RailCard
      title={`This run · ${dayLabel(run.startedAt, clockZone)} · ${clock}`}
    >
      <Mono step="sm">
        {/* Lines of measures (round 52 #158): drawn, and said in words. */}
        <Spoken
          {...measuredLine(
            [
              [{ kind: "distance", distanceM: run.distanceM, spaced: true }],
              [{ kind: "duration", durationS: run.durationS }],
            ],
            units,
          )}
        />
      </Mono>
      {conditions === undefined ? undefined : (
        <>
          <Mono step="sm" className="text-dialed-text">
            <Spoken
              {...measuredLine(
                [
                  [
                    {
                      kind: "temp",
                      tempC: conditions.tempC,
                      withLetter: true,
                    },
                    { kind: "word", word: precipClassOf(conditions.precipMm) },
                  ],
                  [
                    {
                      kind: "temp",
                      tempC: conditions.feelsLikeC,
                      feels: "feels",
                    },
                  ],
                ],
                units,
              )}
            />
          </Mono>
          {/* The header above already credits this reading, heard at
              every width; the rail, the desk's alone, draws it again near
              its own copy of the data and keeps it unheard (R-179's rule:
              the licence is about display). A typed reading is no one's
              to credit. */}
          {isProvidersReading(conditions) ? (
            <WeatherAttribution isRepeat />
          ) : undefined}
        </>
      )}
    </RailCard>
  );
}
