import type { JSX, ReactNode } from "react";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import { precipClassOf } from "../../../lib/contracts/temperature";
import { Mono, PendingLabel, Spoken, WeatherAttribution } from "../../../ui";
import { setBandLabel, SKY_WORDS } from "../run-conditions";
import type { RunConditions, RunSummary } from "../service";

/**
 * A run's conditions, read-only — A1's ink block (Product Screens A1), and
 * run detail's when the weather arrived (round 22, R: *"attached → A1's ink
 * block, read-only"*).
 *
 * **Never an input.** *"Never typed by hand."* A reading from the provider
 * says so and names the provider, as Visual Crossing's terms require on the
 * same screen as the data; one the runner chose in R2b says "set by you"
 * and carries no feels-like line, because a band is all it knows.
 */
export function ConditionsBlock({
  conditions,
  units,
  note,
}: Readonly<{
  conditions: RunConditions;
  units: Units;
  /**
   * A1's line about correcting the time — only where the time can be
   * corrected, so only the parsed card passes one.
   */
  note?: ReactNode;
}>): JSX.Element {
  // A set band reads as the range the runner picked and the sky they
  // picked — never its stored middle (round 26, item 2).
  const { sky } = conditions;
  // The provider's reading is a line of measures (round 52 #158): drawn
  // as two sizes, said as one line in words. A band the runner set has no
  // unit letter, so it is drawn and said as it is.
  const reading = {
    kind: "temp",
    tempC: conditions.tempC,
    withLetter: true,
  } as const;
  const said = measuredLine(
    [[reading, { kind: "word", word: precipClassOf(conditions.precipMm) }]],
    units,
  ).said;
  const temp = conditions.isSetByYou
    ? setBandLabel(conditions.tempC, units.temp)
    : measuredLine([[reading]], units).shown;
  const precip = conditions.isSetByYou
    ? sky && SKY_WORDS[sky]
    : precipClassOf(conditions.precipMm);
  return (
    <div
      data-slot="conditions"
      data-state={conditions.isSetByYou ? "set" : "attached"}
      data-ground="ink"
      className="flex flex-col gap-2 rounded-card bg-ground p-4 text-ink"
    >
      <Mono step="xs" className="text-muted">
        {conditions.isSetByYou
          ? "Conditions · set by you"
          : "Conditions · auto-attached"}
      </Mono>
      <p className="m-0 flex items-baseline gap-2">
        <span
          aria-hidden={conditions.isSetByYou ? undefined : true}
          className="font-display text-display"
        >
          {temp}
        </span>
        <Mono step="sm" className="text-teal">
          <span aria-hidden={conditions.isSetByYou ? undefined : true}>
            {precip}
          </span>
        </Mono>
        {conditions.isSetByYou ? undefined : (
          <span className="sr-only">{said}</span>
        )}
      </p>
      {conditions.isSetByYou ? undefined : (
        <>
          <Mono step="xs" className="text-quiet">
            <Spoken
              {...measuredLine(
                [
                  [
                    {
                      kind: "temp",
                      tempC: conditions.feelsLikeC,
                      feels: "Feels",
                    },
                  ],
                  [{ kind: "humidity", percent: conditions.humidity }],
                  [{ kind: "wind", windKph: conditions.windKph }],
                  [{ kind: "word", word: conditions.condition }],
                ],
                units,
              )}
            />
          </Mono>
          {note}
          <WeatherAttribution />
        </>
      )}
    </div>
  );
}

/**
 * The weather is still being asked for: no badge, no block — the line
 * breathes (round 22, R: *"Pending isn't a badge; the meta line
 * breathes"*).
 */
export function FetchingWeather(): JSX.Element {
  return (
    <Mono step="xs" className="text-muted">
      <PendingLabel label="" pendingLabel="Fetching weather" pending />
    </Mono>
  );
}

/**
What of a run the conditions row reads.
*/
type RowRun = Pick<
  RunSummary,
  "conditions" | "weatherStatus" | "indoor" | "canSetConditions"
>;

/**
The four states a run's weather can be in, in the order the row asks.
*/
type WeatherShown = "attached" | "fetching" | "indoor" | "unavailable";

function weatherShown(run: RowRun): WeatherShown {
  if (run.conditions !== undefined) return "attached";
  if (run.weatherStatus === "pending") return "fetching";
  return run.indoor ? "indoor" : "unavailable";
}

/**
 * What a screen reader is told as the weather changes under A1's card: the
 * breath ("Fetching weather") and the block arriving are both silent on
 * screen, and the runner's focus is elsewhere. In the row's own words where
 * it has them. A treadmill run has no weather to wait for, so nothing.
 */
const WEATHER_SAID: Readonly<Record<WeatherShown, string | undefined>> = {
  attached: "Weather found.",
  fetching: "Fetching weather.",
  indoor: undefined,
  unavailable: "No conditions.",
};

export function weatherSaid(run: RowRun): string | undefined {
  return WEATHER_SAID[weatherShown(run)];
}

/**
 * A run's conditions, in the four states its weather can be in: arrived
 * (the ink block), still being asked for (the breath), indoor (a fact),
 * or never came — "No conditions", with "Set ›" into R2b where the run can
 * take a band (round 22, "R Run before kit").
 */
export function ConditionsRow({
  run,
  units,
  note,
  onSet,
}: Readonly<{
  run: RowRun;
  units: Units;
  note?: ReactNode;
  /**
  Where R2b can open. Absent, the row states the gap and offers nothing.
  */
  onSet?: (() => void) | undefined;
}>): JSX.Element {
  if (run.conditions !== undefined) {
    return (
      <ConditionsBlock conditions={run.conditions} units={units} note={note} />
    );
  }
  const shown = weatherShown(run);
  if (shown === "fetching") return <FetchingWeather />;
  if (shown === "indoor") {
    return (
      <div data-slot="conditions" data-state="indoor">
        <Mono step="xs" className="text-muted">
          Treadmill
        </Mono>
      </div>
    );
  }
  return (
    <div
      data-slot="conditions"
      data-state="unavailable"
      className="flex items-center justify-between gap-3 rounded-card border border-hairline px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <Mono step="xs" className="text-muted">
          No conditions
        </Mono>
        <span className="text-small text-label">
          No weather came back for this time and place.
        </span>
      </div>
      {onSet !== undefined && run.canSetConditions ? (
        <button
          type="button"
          aria-haspopup="dialog"
          // The visible word first (WCAG 2.5.3), and what it sets; the
          // chevron is decoration.
          aria-label="Set conditions"
          onClick={onSet}
          className="target shrink-0 border-none bg-transparent text-body font-bold"
        >
          Set <span aria-hidden="true">&rsaquo;</span>
        </button>
      ) : undefined}
    </div>
  );
}
