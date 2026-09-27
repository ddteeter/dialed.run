import type { JSX, ReactNode } from "react";

import type { Units } from "../../../lib/contracts";
import { formatWind } from "../../../lib/measures";
import { formatTemp, precipClassOf } from "../../../lib/temperature";
import { Mono, PendingLabel, WeatherAttribution } from "../../../ui";
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
  const temp = conditions.isSetByYou
    ? setBandLabel(conditions.tempC, units.temp)
    : `${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()}`;
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
        <span className="font-display text-display">{temp}</span>
        <Mono step="sm" className="text-teal">
          {precip}
        </Mono>
      </p>
      {conditions.isSetByYou ? undefined : (
        <>
          <Mono step="xs" className="text-quiet">
            Feels {formatTemp(conditions.feelsLikeC, units.temp)} ·{" "}
            {Math.round(conditions.humidity)}% hum ·{" "}
            {formatWind(conditions.windKph, units.distance)} ·{" "}
            {conditions.condition}
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
  run: Pick<
    RunSummary,
    "conditions" | "weatherStatus" | "indoor" | "canSetConditions"
  >;
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
  if (run.weatherStatus === "pending") return <FetchingWeather />;
  if (run.indoor) {
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
          onClick={onSet}
          className="target shrink-0 border-none bg-transparent text-body font-bold"
        >
          Set &rsaquo;
        </button>
      ) : undefined}
    </div>
  );
}
