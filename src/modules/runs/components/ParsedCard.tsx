import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { z } from "zod";

import type { Units } from "../../../lib/contracts";
import {
  clockLabel,
  dayLabel,
  shiftToTimeOfDay,
  timeOfDay,
} from "../../../lib/dates";
import {
  distanceNumber,
  formatDuration,
  formatPace,
} from "../../../lib/measures";
import { formatTemp, precipClassOf } from "../../../lib/temperature";
import {
  FormFailureBand,
  FormField,
  FormStatus,
  Mono,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import type { RunSummary } from "../service";
import { ConditionsRow } from "./ConditionsBlock";

/**
 * The server function that moves a run's start, in its own shape.
 */
export type Retime = (input: {
  data: { runId: string; shiftS: number };
}) => Promise<boolean>;

/**
 * The time correction's one field. The sentence is the schema's, as the
 * Form Contract asks; a time input only ever sends `HH:MM` or nothing.
 */
const retimeSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/u, "Pick the time the run started."),
});

/**
 * A duplicate's primary, in ink rather than the log verb's pink: *"opening
 * a run is navigation, not the log verb"* (round 22). One treatment for
 * both of its destinations.
 */
const OPEN_THAT_RUN =
  "target flex items-center justify-center rounded-card bg-ink px-6 py-4 font-display text-body uppercase text-ground no-underline";

/**
 * The card's header strip: the file, and REPLACE — *"the only way back"*
 * to the drop zone (round 20).
 */
function FileStrip({
  label,
  onReplace,
}: Readonly<{ label: string; onReplace: () => void }>): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-tint px-4 py-2">
      <Mono step="xs" className="min-w-0 truncate text-label">
        {label}
      </Mono>
      <button
        type="button"
        onClick={onReplace}
        className="target shrink-0 border-none bg-transparent font-semibold text-cold-text"
      >
        <Mono step="xs">Replace</Mono>
      </button>
    </div>
  );
}

/**
The run in one line: "6.2 mi · 51:38".
*/
function Headline({
  run,
  units,
}: Readonly<{ run: RunSummary; units: Units }>): JSX.Element {
  return (
    <p className="m-0 font-display text-title uppercase">
      {`${distanceNumber(run.distanceM, units.distance)} ${units.distance} · ${formatDuration(run.durationS)}`}
    </p>
  );
}

/**
The mono facts line, cells split by a hairline bar as the board draws them.
*/
function Facts({ children }: Readonly<{ children: ReactNode[] }>): JSX.Element {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 font-mono text-mono-sm uppercase text-label">
      {children.map((cell, index) => (
        <span key={String(index)} className="flex items-center gap-2">
          {index === 0 ? undefined : (
            <span aria-hidden="true" className="text-hairline-2">
              |
            </span>
          )}
          {cell}
        </span>
      ))}
    </p>
  );
}

/**
 * A1's one correction control (round 20): *"the run time on the parsed
 * card: tapping it opens a time picker and re-fetches conditions. Weather
 * itself is never editable."* The time is the run's own clock, and what
 * travels is the shift from it — the server adds seconds and never needs
 * the zone.
 *
 * **Undesigned beyond that sentence**, so composed from the form
 * primitives and nothing else: one `FormField`, the Form Contract's
 * failure band, `SubmitButton`.
 */
function TimeCorrection({
  run,
  retime,
  onDone,
}: Readonly<{
  run: RunSummary;
  retime: Retime;
  onDone: () => void;
}>): JSX.Element {
  const zone = run.conditions?.timeZone;
  const [time, setTime] = useState(timeOfDay(run.startedAt, zone));
  const form = useFormSubmit({
    schema: retimeSchema,
    action: async (values) =>
      retime({
        data: {
          runId: run.id,
          shiftS: shiftToTimeOfDay(run.startedAt, zone, values.time),
        },
      }),
    successMessage: "Time changed. Fetching the weather for it.",
    labels: { time: "Started" },
    onSuccess: onDone,
  });
  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ time });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      {/* `FormField` with its own input, as manual entry's start does:
          `TextField` takes text types only, and a time is picked. */}
      <FormField name="time" label="Started" error={form.fieldErrors.time}>
        <input
          {...form.field("time")}
          id="time"
          type="time"
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
          }}
          className="w-full border-none bg-transparent"
        />
      </FormField>
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Refetch"
        pendingLabel="Refetching"
        pending={form.pending}
      />
    </form>
  );
}

/**
 * A1 done: the parsed card and its conditions, in place (Product Screens
 * A1). *"The parsed card and conditions block appear together the moment
 * the file lands — one screen, no wizard step for weather."*
 */
export function ParsedCard({
  filename,
  run,
  units,
  retime,
  onRetimed,
  onReplace,
}: Readonly<{
  filename: string;
  run: RunSummary;
  units: Units;
  retime: Retime;
  /**
  After the start moved: the caller asks for the run again.
  */
  onRetimed: () => void;
  onReplace: () => void;
}>): JSX.Element {
  const [isRetiming, setIsRetiming] = useState(false);
  const zone = run.conditions?.timeZone;

  return (
    <>
      <div
        data-slot="parsed-card"
        data-state="parsed"
        className="overflow-hidden rounded-card border border-hairline bg-panel"
      >
        <FileStrip label={`Parsed · ${filename}`} onReplace={onReplace} />
        <div className="flex flex-col gap-2 p-4">
          <Headline run={run} units={units} />
          <Facts>
            {[
              formatPace(run.durationS, run.distanceM, units.distance),
              dayLabel(run.startedAt, zone),
              <button
                key="time"
                type="button"
                aria-expanded={isRetiming}
                aria-label={`Started ${clockLabel(run.startedAt, zone)} — change the time`}
                onClick={() => {
                  setIsRetiming(!isRetiming);
                }}
                className="target border-none bg-transparent p-0 font-mono text-mono-sm uppercase text-ink underline underline-offset-4"
              >
                {clockLabel(run.startedAt, zone)}
              </button>,
            ]}
          </Facts>
          {isRetiming ? (
            <TimeCorrection
              run={run}
              retime={retime}
              onDone={() => {
                setIsRetiming(false);
                onRetimed();
              }}
            />
          ) : undefined}
        </div>
      </div>
      <ConditionsRow
        run={run}
        units={units}
        note={
          <p className="m-0 text-small text-quiet">
            Never typed by hand. Wrong time? Tap it on the run card and
            we&rsquo;ll refetch.
          </p>
        }
      />
      <Link
        to="/feed/attach/$runId"
        params={{ runId: run.id }}
        data-slot="primary-action"
        className="target flex items-center justify-center rounded-card bg-action px-6 py-4 font-display text-body uppercase text-ink no-underline"
      >
        Looks right — what did you wear?
      </Link>
    </>
  );
}

/**
 * A1 duplicate: *"Not a failure: nothing is wrong and nothing to fix. It's
 * a receipt, in the parsed card's place, drawn from the existing run (its
 * conditions, not a re-fetch)"* (round 22). The primary goes ink — opening
 * a run is navigation, not the log verb — and opens the run where it is:
 * A2 if it has no kit, the run otherwise.
 */
export function DuplicateCard({
  filename,
  run,
  units,
  onReplace,
}: Readonly<{
  filename: string;
  run: RunSummary;
  units: Units;
  onReplace: () => void;
}>): JSX.Element {
  const { conditions, entryId } = run;
  const zone = conditions?.timeZone;
  const facts: ReactNode[] = [
    dayLabel(run.startedAt, zone),
    clockLabel(run.startedAt, zone),
  ];
  if (conditions !== undefined) {
    facts.push(
      <span key="conditions" className="text-dialed-text">
        {`${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()} ${precipClassOf(conditions.precipMm)}`}
      </span>,
    );
  }

  return (
    <>
      <div
        data-slot="parsed-card"
        data-state="duplicate"
        className="overflow-hidden rounded-card border border-hairline bg-panel"
      >
        <FileStrip label={filename} onReplace={onReplace} />
        <div className="flex flex-col gap-2 p-4">
          <Mono step="xs" className="text-muted">
            Already logged
          </Mono>
          <Headline run={run} units={units} />
          <Facts>{facts}</Facts>
          <p className="m-0 text-body">
            This run is already in your log. Nothing new was added.
          </p>
        </div>
      </div>
      {entryId === undefined ? (
        <Link
          to="/feed/attach/$runId"
          params={{ runId: run.id }}
          data-slot="primary-action"
          className={OPEN_THAT_RUN}
        >
          Open that run
        </Link>
      ) : (
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          data-slot="primary-action"
          className={OPEN_THAT_RUN}
        >
          Open that run
        </Link>
      )}
      <p className="m-0 text-center text-small text-muted">
        Wrong file? Tap Replace above.
      </p>
    </>
  );
}
