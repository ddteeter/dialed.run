import { Link, useRouter } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import { verdictScale } from "../../../lib/contracts";
import type { Units } from "../../../lib/contracts";
import type { MeasuredLine } from "../../../lib/contracts/measures";
import { dayLabel } from "../../../lib/dates";
import { measuredLine } from "../../../lib/contracts/measures";
import { precipClassOf } from "../../../lib/contracts/temperature";
import {
  Bracketed,
  GarminAttribution,
  Mono,
  PendingLabel,
  Spoken,
  WeatherAttribution,
} from "../../../ui";
import {
  hasProvidersReading,
  setBandForms,
  SKY_WORDS,
} from "../run-conditions";
import type { RunConditions, RunSummary } from "../service";
import { listedSince, runMonths } from "../run-months";
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

  const since = listedSince(runs);
  return (
    <>
      <div data-slot="run-list" className="flex flex-col">
        {runMonths(runs).map(({ month, runs: inMonth }) => (
          <section key={month} aria-label={month} className="flex flex-col">
            {/* Round 55 · 235: a month break in MONO.xs with its count. */}
            <h2 className="m-0 border-b border-hairline pt-5 pb-2">
              <Mono step="xs" className="text-label">
                {`${month} · ${String(inMonth.length)} ${inMonth.length === 1 ? "run" : "runs"}`}
              </Mono>
            </h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {inMonth.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  units={units}
                  onSet={() => {
                    setSettingFor(run.id);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
        {/* The list says where it ends, and only when it has: never
            "every run" about the newest of more than it read. */}
        {since === undefined ? undefined : (
          <Mono step="xs" className="block pt-6 pb-4 text-center text-label">
            That&rsquo;s every run · since {since}
          </Mono>
        )}
      </div>
      {/* One credit under the list, rather than one per row, when any row
          shows the provider's reading — a band the runner set is theirs
          and needs none (D-144). */}
      {runs.some((run) => hasProvidersReading(run)) ? (
        <WeatherAttribution />
      ) : undefined}
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

/**
 * One 64 row (Round 55 · 235): the date, one mono line under it, and the
 * verdict and kit marks at the right, so the runs that still need
 * something stand out. A badge only for an exception.
 */
function RunRow({
  run,
  units,
  onSet,
}: Readonly<{
  run: RunSummary;
  units: Units;
  onSet: () => void;
}>): JSX.Element {
  return (
    <li
      data-slot="run-row"
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <RunLink run={run} units={units} />
        <div className="flex min-w-0 items-center gap-2">
          <MetaLine run={run} units={units} />
          <RunBadge run={run} units={units} onSet={onSet} />
          {/* Once per row: a header line would claim the whole of a
              mixed list (G1). Sentence case and sans, never the mono
              line's capitals, so it stays beside the line, not in it. */}
          <GarminAttribution deviceName={run.deviceName} />
        </div>
      </div>
      <Marks run={run} />
    </li>
  );
}

/**
 * The row's way in — to D, to A3, or to run detail: the date, underlined
 * as the board draws it, its 44 hit area proud of the line rather than
 * growing it.
 */
const ROW_LINK =
  "target-line inline-block self-start text-body font-semibold text-ink underline underline-offset-4";

function RunLink({
  run,
  units,
}: Readonly<{ run: RunSummary; units: Units }>): JSX.Element {
  const { entryId } = run;
  const day = dayLabel(run.startedAt, run.clockZone);
  // Said with its distance, so two runs on one day are two different
  // links to a screen reader, as they were before the row lost its line.
  const { said: distance } = measuredLine(
    [[{ kind: "distance", distanceM: run.distanceM, spaced: true }]],
    units,
  );
  const name = <Spoken shown={day} said={`${day}, ${distance}`} />;
  if (entryId === undefined) {
    return (
      <Link to="/runs/$runId" params={{ runId: run.id }} className={ROW_LINK}>
        {name}
      </Link>
    );
  }
  return run.hasVerdict ? (
    <Link to="/feed/entry/$entryId" params={{ entryId }} className={ROW_LINK}>
      {name}
    </Link>
  ) : (
    <Link to="/feed/verdict/$entryId" params={{ entryId }} className={ROW_LINK}>
      {name}
    </Link>
  );
}

/**
 * What the row's one mono line leads with, before the distance: the
 * reading in the dialed text colour when it came from the weather;
 * "Indoor"; what is missing when nothing can be set; nothing when a band
 * the runner set is the badge's, or the control asks for one.
 */
function leadOf(run: RunSummary): MeasuredLine[number] | undefined {
  const { conditions } = run;
  if (conditions !== undefined) {
    // A set band's numbers are the badge's (round 26, item 2); the line
    // never shows the stored middle.
    if (conditions.isSetByYou) return undefined;
    return [
      { kind: "temp", tempC: conditions.tempC, withLetter: true },
      { kind: "word", word: precipClassOf(conditions.precipMm) },
    ];
  }
  if (run.indoor) return [{ kind: "word", word: "Indoor" }];
  if (run.canSetConditions) return undefined;
  return [{ kind: "word", word: "No weather for this time" }];
}

/**
 * The row's one mono line (Round 55 · 235): conditions · distance, drawn
 * and said (round 52 #158), on one line that truncates rather than wraps.
 * While the weather is asked for, the line starts with its breathing
 * brackets, flush left like every other line (N1-14).
 */
function MetaLine({
  run,
  units,
}: Readonly<{ run: RunSummary; units: Units }>): JSX.Element {
  const distance: MeasuredLine[number] = [
    { kind: "distance", distanceM: run.distanceM, spaced: true },
  ];
  if (run.conditions === undefined && run.weatherStatus === "pending") {
    return (
      <Mono step="sm" className="flex min-w-0 items-center gap-1 text-label">
        <PendingLabel
          label=""
          pendingLabel="Fetching weather"
          pending
          align="start"
        />
        <span aria-hidden="true">·</span>
        <Spoken {...measuredLine([distance], units)} />
      </Mono>
    );
  }
  const lead = leadOf(run);
  const isReading = run.conditions !== undefined && !run.conditions.isSetByYou;
  return (
    <Mono
      step="sm"
      className={`min-w-0 truncate ${isReading ? "text-dialed-text" : "text-label"}`}
    >
      <Spoken
        {...measuredLine(
          lead === undefined ? [distance] : [lead, distance],
          units,
        )}
      />
    </Mono>
  );
}

/**
 * The badge of a run whose conditions the runner set: `SET · 41–50° ·
 * RAIN` (round 26, item 2) — the range and the sky, never the stored
 * middle — said "Set, 41 to 50 degrees, rain" (round 53 · 162.3). A band
 * set before the sheet asked for a sky has none to show.
 */
function setBadge(
  conditions: Pick<RunConditions, "tempC" | "sky">,
  units: Units,
): { shown: string; said: string } {
  const band = setBandForms(conditions.tempC, units.temp);
  if (conditions.sky === undefined)
    return { shown: `Set · ${band.shown}`, said: `Set, ${band.said}` };
  const sky = SKY_WORDS[conditions.sky];
  return {
    shown: `Set · ${band.shown} · ${sky}`,
    said: `Set, ${band.said}, ${sky.toLowerCase()}`,
  };
}

/**
 * Every badge on the list is one pill, 22 tall (Round 55 · 235b): MONO.xs
 * on SPACE[1] above and below, inside a hairline.
 */
const BADGE = "inline-flex shrink-0 items-center rounded-pill border px-2 py-1";
const FACT_BADGE = `${BADGE} border-hairline text-label`;
const CONTROL_BADGE = `${BADGE} border-ink text-ink`;

/**
 * The row's badge, only for an exception: a band the runner set, or the
 * one control, "SET CONDITIONS ›", into R2b. Its 44 hit area hangs past
 * the line on both sides rather than making the row taller.
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
  if (run.conditions?.isSetByYou === true) {
    return (
      <Mono step="xs" className={FACT_BADGE}>
        <Spoken {...setBadge(run.conditions, units)} />
      </Mono>
    );
  }
  if (run.conditions !== undefined || !run.canSetConditions) return undefined;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onSet}
      className="target -my-3 inline-flex shrink-0 items-center border-none bg-transparent p-0"
    >
      {/* The › is drawn, not said: it reads as "right angle bracket". */}
      <Mono step="xs" className={CONTROL_BADGE}>
        Set conditions <span aria-hidden="true">&rsaquo;</span>
      </Mono>
    </button>
  );
}

/**
 * The verdict's mark in its T2 text hue: dialed teal, cold in the cold
 * text colour, warm in `--quiet` — the sign carries the hue, the words
 * the degree.
 */
function verdictTone(verdict: number): string {
  if (verdict < 0) return "text-cold-text";
  return verdict > 0 ? "text-quiet" : "text-dialed-text";
}

/**
The verdict and kit marks at the row's right (Round 55 · 235).
*/
function Marks({ run }: Readonly<{ run: RunSummary }>): JSX.Element {
  const verdict = verdictScale.find((step) => step.value === run.verdict);
  return (
    <div data-part="run-marks" className="flex flex-col items-end gap-1">
      {verdict === undefined ? (
        <Mono step="xs" className="font-semibold text-muted">
          No verdict
        </Mono>
      ) : (
        <Mono
          step="xs"
          className={`font-semibold ${verdictTone(verdict.value)}`}
        >
          {verdict.label}
        </Mono>
      )}
      <Mono step="xs" className="text-label">
        {run.entryId === undefined ? "No kit" : "Kit"}
      </Mono>
    </div>
  );
}
