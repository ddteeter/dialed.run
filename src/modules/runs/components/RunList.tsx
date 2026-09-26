import { Link, useRouter } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { dayLabel } from "../../../lib/dates";
import { distanceNumber } from "../../../lib/measures";
import { formatTemp, precipClassOf } from "../../../lib/temperature";
import { Bracketed, Mono } from "../../../ui";
import { setBandLabel, SKY_WORDS } from "../run-conditions";
import type { RunConditions, RunSummary } from "../service";
import { FetchingWeather } from "./ConditionsBlock";
import { SetConditionsSheet } from "./SetConditionsSheet";
import type { ConditionsActions } from "./SetConditionsSheet";

/**
 * The runs list (round 22, "R Runs list"). *"Five badges collapse to four
 * and one breath"*: conditions attached, indoor and set-by-you are facts —
 * hairline and muted; unavailable is the one control, an ink hairline
 * "SET CONDITIONS ›" that opens R2b; pending is no badge at all, the meta
 * line breathes. "Manual temperature" is gone with its form.
 *
 * A run goes where its entry is: a verdict opens D, a kit with no verdict
 * opens A3, and a run with neither opens run detail.
 */
export function RunList({
  runs,
  units,
  actions,
}: Readonly<{
  runs: readonly RunSummary[];
  units: Units;
  actions: ConditionsActions;
}>): JSX.Element {
  const router = useRouter();
  const [settingFor, setSettingFor] = useState<string | undefined>();

  if (runs.length === 0) {
    return (
      <div
        data-slot="run-list"
        data-state="empty"
        className="flex flex-col gap-4"
      >
        <Bracketed>No runs yet</Bracketed>
        <p className="m-0 text-body">Upload a file or enter one by hand.</p>
        <Link
          to="/runs/new"
          className="target flex items-center justify-center self-start rounded-pill bg-ink px-5 py-3 font-semibold text-ground no-underline"
        >
          Log a run
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul data-slot="run-list" className="m-0 flex list-none flex-col p-0">
        {runs.map((run) => (
          <li
            key={run.id}
            data-slot="run-row"
            className="flex items-center justify-between gap-3 border-b border-hairline py-3"
          >
            <RunLink run={run}>
              <span className="text-body font-semibold">
                {`${distanceNumber(run.distanceM, units.distance)} ${units.distance} · ${dayLabel(run.startedAt, run.conditions?.timeZone)}`}
              </span>
              <MetaLine run={run} units={units} />
            </RunLink>
            <RunBadge
              run={run}
              units={units}
              onSet={() => {
                setSettingFor(run.id);
              }}
            />
          </li>
        ))}
      </ul>
      {/* Mounted only while a run is asking, so every run's sheet starts
          at its own first step rather than the last one's band list. */}
      {settingFor === undefined ? undefined : (
        <SetConditionsSheet
          runId={settingFor}
          units={units}
          open
          onClose={() => {
            setSettingFor(undefined);
          }}
          onDone={async () => {
            setSettingFor(undefined);
            await router.invalidate();
          }}
          actions={actions}
        />
      )}
    </>
  );
}

const ROW_LINK =
  "target flex min-w-0 flex-1 flex-col gap-1 text-ink no-underline";

/**
The row's way in — to D, to A3, or to run detail.
*/
function RunLink({
  run,
  children,
}: Readonly<{ run: RunSummary; children: JSX.Element[] }>): JSX.Element {
  const { entryId } = run;
  if (entryId === undefined) {
    return (
      <Link to="/runs/$runId" params={{ runId: run.id }} className={ROW_LINK}>
        {children}
      </Link>
    );
  }
  return run.hasVerdict ? (
    <Link to="/feed/entry/$entryId" params={{ entryId }} className={ROW_LINK}>
      {children}
    </Link>
  ) : (
    <Link to="/feed/verdict/$entryId" params={{ entryId }} className={ROW_LINK}>
      {children}
    </Link>
  );
}

/**
 * The meta line under a row: the conditions in mono, in the dialed text
 * colour when they came from the weather; "set by you" when R2b set them;
 * what is missing otherwise.
 */
function MetaLine({
  run,
  units,
}: Readonly<{ run: RunSummary; units: Units }>): JSX.Element {
  const { conditions } = run;
  if (conditions !== undefined) {
    // A set band's numbers are the badge's (round 26, item 2); the line
    // only says who set them, and never shows the stored middle.
    if (conditions.isSetByYou) {
      return (
        <Mono step="sm" className="text-label">
          Set by you
        </Mono>
      );
    }
    const temp = `${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()}`;
    return (
      <Mono step="sm" className="text-dialed-text">
        {`${temp} ${precipClassOf(conditions.precipMm)}`}
      </Mono>
    );
  }
  if (run.weatherStatus === "pending") return <FetchingWeather />;
  return (
    <Mono step="sm" className="text-muted">
      {run.indoor ? "Treadmill" : "No weather for this time"}
    </Mono>
  );
}

/**
 * The badge of a run whose conditions the runner set: `SET · 41–50° ·
 * RAIN` (round 26, item 2) — the range and the sky, never the stored
 * middle. A band set before the sheet asked for a sky has none to show.
 */
function setBadge(
  conditions: Pick<RunConditions, "tempC" | "sky">,
  units: Units,
): string {
  const band = `Set · ${setBandLabel(conditions.tempC, units.temp)}`;
  return conditions.sky === undefined
    ? band
    : `${band} · ${SKY_WORDS[conditions.sky]}`;
}

const FACT_BADGE =
  "shrink-0 rounded-pill border border-hairline px-3 py-1 text-label";

/**
The row's badge: a fact, the one control, or nothing while it breathes.
*/
function RunBadge({
  run,
  units,
  onSet,
}: Readonly<{
  run: RunSummary;
  units: Units;
  onSet: () => void;
}>): JSX.Element | undefined {
  if (run.indoor) {
    return (
      <Mono step="xs" className={FACT_BADGE}>
        Indoor
      </Mono>
    );
  }
  if (run.conditions !== undefined) {
    return (
      <Mono step="xs" className={FACT_BADGE}>
        {run.conditions.isSetByYou
          ? setBadge(run.conditions, units)
          : "Conditions"}
      </Mono>
    );
  }
  if (!run.canSetConditions) return undefined;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onSet}
      className="target shrink-0 rounded-pill border border-ink bg-transparent px-3 text-ink"
    >
      <Mono step="xs">Set conditions &rsaquo;</Mono>
    </button>
  );
}
