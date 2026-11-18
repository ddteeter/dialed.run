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
import { hasProvidersReading, setConditionsForms } from "../run-conditions";
import type { RunListPage, RunSummary } from "../service";
import {
  RUNS_LISTED,
  listedSince,
  monthCount,
  moreToShow,
  runMonths,
} from "../run-months";
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
  page,
  show,
  units,
  actions,
}: Readonly<{
  page: RunListPage;
  /**
  How many the list asked for: the next "Show 50 more" asks for fifty more.
  */
  show: number;
  units: Units;
  actions: ConditionsActions;
}>): JSX.Element {
  const { runs } = page;
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
      <div data-slot="run-list" className="flex flex-col">
        {runMonths(runs).map(({ month, runs: inMonth }) => (
          <section key={month} aria-label={month} className="flex flex-col">
            {/* Round 55 · 235: a month break in MONO.xs with its count. */}
            <h2 className="m-0 border-b border-hairline pt-5 pb-2">
              <Mono step="xs" className="text-label">
                {monthBreak(
                  month,
                  monthCount(month, inMonth.length, page.cutMonth),
                )}
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
        <ListEnd runs={runs} total={page.total} show={show} />
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
 * A month break (Round 55 · 235): the month, then its count, singular for
 * one (D-191). The count is the whole month's (R58·299).
 */
function monthBreak(month: string, count: number): string {
  return `${month} · ${String(count)} ${count === 1 ? "run" : "runs"}`;
}

/**
 * Where the list stops (R58·299): "Show N more" while there are more, as
 * 236a's "Show 9 more", in the closet's text-link form; the end line once
 * every run is listed, and never "every run" about the newest of more.
 * Show keeps the scroll where it is, so the next runs arrive under it.
 */
function ListEnd({
  runs,
  total,
  show,
}: Readonly<{
  runs: readonly RunSummary[];
  total: number;
  show: number;
}>): JSX.Element {
  // The two are each other's opposite: every run is listed exactly when
  // there are none more to show, so the end line decides.
  const since = listedSince(runs, total);
  if (since !== undefined) {
    return (
      <Mono step="xs" className="block pt-6 pb-4 text-center text-label">
        That&rsquo;s every run · since {since}
      </Mono>
    );
  }
  return (
    <Link
      to="/runs"
      search={{ show: show + RUNS_LISTED }}
      // Fifty more land under the row that asked for them, so the page
      // stays where the runner was reading.
      resetScroll={false}
      data-part="show-more"
      className="target mt-4 inline-flex items-center self-start text-small text-ink underline underline-offset-4"
    >
      {`Show ${String(moreToShow(runs.length, total))} more`}
    </Link>
  );
}

/**
 * One 64 row (Round 55 · 235): the date, one mono line under it, and the
 * verdict and kit marks at the right, so the runs that still need
 * something stand out. A badge only for an exception.
 *
 * A badged row breathes (R60·326): the badge takes a line of its own
 * under the mono line, at the row's start with nothing beside it, and the
 * row pads 12 above and 16 below, so 12 + 20 + 4 + 16 + 14 + 22 + 16 =
 * 104. The marks keep their place at the top right. A row with no badge
 * stays 64, its lines centred in it.
 */
const ROW =
  "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline";
const BADGED_ROW =
  "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-hairline pt-3 pb-4";

/**
 * The badge's line: 14 under the mono line, the column's 4 and this 10.
 */
const BADGE_LINE = "mt-2.5 flex";

function RunRow({
  run,
  units,
  onSet,
}: Readonly<{
  run: RunSummary;
  units: Units;
  onSet: () => void;
}>): JSX.Element {
  const badge = badgeOf(run);
  return (
    <li
      data-slot="run-row"
      data-badged={badge === undefined ? undefined : "true"}
      className={badge === undefined ? ROW : BADGED_ROW}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <RunLink run={run} units={units} />
        {/* Wraps rather than shrinks (R2-RUNS-02): the distance and the
            badge are never cut, and neither is the Garmin credit (Garmin
            Rulings 77), so on a row too narrow for all three the credit
            takes its own line, as on the feed card. A guess until Design
            314 (#760) rules between 77 and 235's one line. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <MetaLine run={run} units={units} />
          {/* Once per row: a header line would claim the whole of a
              mixed list (G1). Sentence case and sans, never the mono
              line's capitals, so it stays beside the line, not in it. */}
          {run.deviceName === undefined ? undefined : (
            <div data-part="watch" className="whitespace-nowrap">
              <GarminAttribution deviceName={run.deviceName} />
            </div>
          )}
        </div>
        {badge === undefined ? undefined : (
          <div data-part="run-badge" className={BADGE_LINE}>
            {badge.conditions === undefined ? (
              <SetConditionsBadge onSet={onSet} />
            ) : (
              <SetBadge conditions={badge.conditions} units={units} />
            )}
          </div>
        )}
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
    [[{ kind: "distance", distanceM: run.distanceM }]],
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
 * Every badge on the list is one pill, 22 tall (Round 55 · 235b): MONO.xs
 * on SPACE[1] above and below, inside a hairline.
 */
const BADGE = "inline-flex shrink-0 items-center rounded-pill border px-2 py-1";
const FACT_BADGE = `${BADGE} border-hairline text-label`;
const CONTROL_BADGE = `${BADGE} border-ink text-ink`;

/**
 * Which badge a row draws, if any: a band the runner set, or the one
 * control, "SET CONDITIONS ›", into R2b. Only for an exception.
 */
type SetConditions = NonNullable<RunSummary["conditions"]>;

/**
 * The row's badge, or none: a fact badge carries the band the runner set,
 * and the control carries nothing, since all it does is open R2b.
 */
function badgeOf(run: RunSummary): { conditions?: SetConditions } | undefined {
  const { conditions } = run;
  if (conditions?.isSetByYou === true) return { conditions };
  if (conditions !== undefined || !run.canSetConditions) return undefined;
  return {};
}

/**
 * The fact badge: a band the runner set, its range and sky.
 */
function SetBadge({
  conditions,
  units,
}: Readonly<{
  conditions: SetConditions;
  units: Units;
}>): JSX.Element {
  return (
    <Mono step="xs" className={FACT_BADGE}>
      <Spoken
        {...setConditionsForms(conditions.tempC, conditions.sky, units.temp)}
      />
    </Mono>
  );
}

/**
 * The one control badge, into R2b. Its 44 hit area is a `target-line`,
 * eleven proud of the 22 pill above and below, and it sits wholly inside
 * the row (R60·326): the 14 above the badge and the row's 16 below hold
 * it.
 */
function SetConditionsBadge({
  onSet,
}: Readonly<{ onSet: () => void }>): JSX.Element {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onSet}
      className="target-line inline-flex shrink-0 items-center border-none bg-transparent p-0"
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
