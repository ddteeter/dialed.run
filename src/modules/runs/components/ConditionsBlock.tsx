import type { JSX, ReactNode } from "react";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import { precipClassOf } from "../../../lib/contracts/temperature";
import { Mono, Spoken, WeatherAttribution } from "../../../ui";
import { setBandForms, SKY_WORDS } from "../run-conditions";
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
  // as two sizes, said as one line in words. A band the runner set is a
  // range, said as one (round 53 · 162.3), then the sky they picked.
  const reading = {
    kind: "temp",
    tempC: conditions.tempC,
    withLetter: true,
  } as const;
  const band = setBandForms(conditions.tempC, units.temp);
  const provided = precipClassOf(conditions.precipMm);
  const precip = conditions.isSetByYou ? sky && SKY_WORDS[sky] : provided;
  const temp = conditions.isSetByYou
    ? band.shown
    : measuredLine([[reading]], units).shown;
  const said = conditions.isSetByYou
    ? setSaid(band.said, precip)
    : measuredLine([[reading, { kind: "word", word: provided }]], units).said;
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
        <span aria-hidden="true" className="font-display text-display">
          {temp}
        </span>
        {/* The text role, which resolves per ground: the surface teal on
            the dark theme's chalk block was 1.5:1 (D1-03). */}
        <Mono step="sm" className="text-dialed-text">
          <span aria-hidden="true">{precip}</span>
        </Mono>
        <span className="sr-only">{said}</span>
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
 * A set band as it is said: "41 to 50 degrees, rain", or the band alone
 * when it was set before the sheet asked for a sky.
 */
function setSaid(band: string, sky: string | undefined): string {
  return sky === undefined ? band : `${band}, ${sky.toLowerCase()}`;
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
 * The slot keeps the block's size while there is no block (Round 55 ·
 * 233), so nothing under it jumps when the weather lands. The block's
 * resting height: its padding, kicker, display line, feels-like line and
 * credit.
 */
const SLOT_CLASS = "min-h-34 rounded-card p-4";

/**
 * Round 55 · 233, waiting: a --hairline-2 outline in the block's place,
 * FETCHING WEATHER at its top left and what to expect under it. The runner
 * can go on without it.
 */
function WaitingForWeather(): JSX.Element {
  return (
    <div
      data-slot="conditions"
      data-state="fetching"
      className={`flex flex-col gap-2 border border-hairline-2 ${SLOT_CLASS}`}
    >
      <Mono step="xs" className="text-ink">
        Fetching weather
      </Mono>
      <span className="text-small text-label">
        Usually under a minute. You can go on without it.
      </span>
    </div>
  );
}

/**
 * Round 55 · 233, a treadmill: the ink block, which says what the run was
 * rather than what the sky did — CONDITIONS · INDOOR over TREADMILL, and
 * NO WEATHER FOR AN INDOOR RUN at its foot.
 */
function IndoorBlock(): JSX.Element {
  return (
    <div
      data-slot="conditions"
      data-state="indoor"
      data-ground="ink"
      className={`flex flex-col justify-between gap-2 bg-ground text-ink ${SLOT_CLASS}`}
    >
      <span className="flex flex-col gap-2">
        <Mono step="xs" className="text-muted">
          Conditions · indoor
        </Mono>
        <Mono step="lg">Treadmill</Mono>
      </span>
      <Mono step="xs" className="text-muted">
        No weather for an indoor run
      </Mono>
    </div>
  );
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
  if (shown === "fetching") return <WaitingForWeather />;
  if (shown === "indoor") return <IndoorBlock />;
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
