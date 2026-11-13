import { Link, useNavigate } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { useEffect, useState } from "react";
import { z } from "zod";

import type { Units } from "../../../lib/contracts";
import {
  clockLabel,
  dayLabel,
  deviceTimeZone,
  startAtTimeOfDay,
  timeOfDay,
} from "../../../lib/dates";
import {
  distanceNumber,
  formatDuration,
  measuredLine,
  paceForms,
  spokenDuration,
} from "../../../lib/contracts/measures";
import { precipClassOf } from "../../../lib/contracts/temperature";
import {
  GarminAttribution,
  type ControlFailure,
  ControlFailureBand,
  describedByFor,
  FormFailureBand,
  FormField,
  FormStatus,
  Mono,
  PendingLabel,
  Spoken,
  SubmitButton,
  useFormSubmit,
  WeatherAttribution,
  focusOnMount,
} from "../../../ui";
import { hasProvidersReading } from "../run-conditions";
import type { RunSummary } from "../service";
import { ConditionsRow } from "./ConditionsBlock";

/**
 * The server function that moves a run's start, in its own shape.
 */
export type Retime = (input: {
  data: { runId: string; startedAt: number; timeZone?: string | undefined };
}) => Promise<"moved" | "no-weather" | "refused">;

/**
 * The time correction's one field. The sentence is the schema's, as the
 * Form Contract asks; a time input only ever sends `HH:MM` or nothing.
 */
const retimeSchema = z.object({
  // zod's own clock time, to the minute, rather than a hand-written
  // pattern: the input sanitises what it holds, so a pattern's edges were
  // rules no runner — and no test — could ever reach.
  time: z.iso.time({ precision: -1, error: "Pick the time the run started." }),
});

/**
 * A duplicate's primary, in ink rather than the log verb's pink: *"opening
 * a run is navigation, not the log verb"* (round 22). One treatment for
 * both of its destinations.
 */
const PRIMARY_ACTION =
  "target flex items-center justify-center rounded-card bg-action px-6 py-4 font-display text-body uppercase text-accent-ink desk:col-start-1 desk:row-start-3 desk:self-start desk:justify-self-start";

const LOOKS_RIGHT = "Looks right — what did you wear?";

const OPEN_THAT_RUN =
  "target flex items-center justify-center rounded-card bg-ink px-6 py-4 font-display text-body uppercase text-ground no-underline";

/**
 * Where focus goes when the card takes the well's place. The well held
 * focus — the runner had just picked a file in it — and its input went
 * with it, leaving focus on the page itself. So the strip's line takes it,
 * and a screen reader starts from the card's first words. Only when focus
 * is lost: a runner who has moved on keeps their place. A ref callback at
 * module scope, as `ui`'s `focusOnMount` is, so React calls it once as the
 * strip mounts.
 */
export function focusIfLost(line: HTMLElement | null | undefined): void {
  // A removed element's focus falls to the body, in every browser.
  if (document.activeElement === document.body) line?.focus();
}

/**
 * The card's header strip: the file, and REPLACE — *"the only way back"*
 * to the drop zone (round 20). Replace's name carries the file it
 * replaces, after the word it shows (WCAG 2.5.3).
 */
function FileStrip({
  label,
  filename,
  onReplace,
}: Readonly<{
  label: string;
  filename: string;
  onReplace: () => void;
}>): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-notice inset-ring-1 inset-ring-notice-rule px-4 py-2">
      {/* `--quiet`: the strip is tinted, and `--label` is 4.0:1 on the tint. */}
      <span
        ref={focusIfLost}
        tabIndex={-1}
        data-part="file-line"
        className="min-w-0 truncate"
      >
        <Mono step="xs" className="text-quiet">
          {label}
        </Mono>
      </span>
      <button
        type="button"
        aria-label={`Replace ${filename}`}
        onClick={onReplace}
        className="target shrink-0 border-none bg-transparent font-semibold text-cold-text"
      >
        <Mono step="xs">Replace</Mono>
      </button>
    </div>
  );
}

/**
 * The start time on the stats line, as the button that changes it. Its
 * name starts with what it shows (WCAG 2.5.3): a voice user says what
 * they see, and "6:04 AM · Changed" was not in "Change start time,
 * 6:04 AM".
 */
function TimeButton({
  shown,
  onPress,
}: Readonly<{ shown: string; onPress: () => void }>): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`${shown}, change start time`}
      onClick={onPress}
      className="target border-none bg-transparent p-0 font-mono text-mono-sm uppercase text-ink underline underline-offset-4"
    >
      {shown}
    </button>
  );
}

/**
The run in one line: "6.2 mi · 51:38", its time said in words.
*/
function Headline({
  run,
  units,
}: Readonly<{ run: RunSummary; units: Units }>): JSX.Element {
  const distance = `${distanceNumber(run.distanceM, units.distance)} ${units.distance}`;
  return (
    <p className="m-0 font-display text-title uppercase">
      <Spoken
        shown={`${distance} · ${formatDuration(run.durationS)}`}
        said={`${distance}, ${spokenDuration(run.durationS)}`}
      />
    </p>
  );
}

/**
The pace cell, said in words; nothing for a run with no distance.
*/
function paceCell(run: RunSummary, units: Units): ReactNode {
  const pace = paceForms(run.durationS, run.distanceM, units.distance);
  return pace === undefined ? undefined : <Spoken key="pace" {...pace} />;
}

/**
The mono facts line, cells split by a hairline bar as the board draws them.
*/
function Facts({ children }: Readonly<{ children: ReactNode[] }>): JSX.Element {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 font-mono text-mono-sm uppercase text-label">
      {/* A cell with nothing in it — a run with no distance has no pace —
          is no cell, so no rule stands before the first one drawn. */}
      {children
        .filter((cell) => cell !== undefined)
        .map((cell, index) => (
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
 * What the run's conditions were before the correction, for the WAS line —
 * "41°F damp · feels 36°", or that there were none. A line of measures
 * (round 52 #158): drawn, and said in words.
 */
function conditionsWords(
  run: RunSummary,
  units: Units,
): { shown: string; said: string } {
  const { conditions } = run;
  if (conditions === undefined) {
    return { shown: "no weather", said: "no weather" };
  }
  return measuredLine(
    [
      [
        { kind: "temp", tempC: conditions.tempC, withLetter: true },
        { kind: "word", word: precipClassOf(conditions.precipMm) },
      ],
      [{ kind: "temp", tempC: conditions.feelsLikeC, feels: "feels" }],
    ],
    units,
  );
}

/**
 * The conditions block while the weather for a corrected start is being
 * asked for (round 26, item 1): *"WEATHER FOR {t} · [ Getting it ] · WAS
 * {old} · AT {t0}"*. At the desk it is in the rail, where the block is.
 */
function WeatherFor({
  time,
  was,
  at,
  isProviders,
}: Readonly<{
  time: string;
  was: { shown: string; said: string };
  at: string;
  /**
  Whether WAS is the provider's reading, which keeps its credit (D-144).
  */
  isProviders: boolean;
}>): JSX.Element {
  return (
    <div
      data-slot="conditions"
      data-state="fetching"
      data-ground="ink"
      className="flex flex-col gap-2 rounded-card bg-ground p-4 text-ink"
    >
      <Mono step="xs" className="text-muted">
        {`Weather for ${time}`}
      </Mono>
      <Mono step="sm">
        <PendingLabel label="" pendingLabel="Getting it" pending />
      </Mono>
      <Mono step="xs" className="text-quiet">
        Was <Spoken {...was} />
        {` · at ${at}`}
      </Mono>
      {isProviders ? <WeatherAttribution /> : undefined}
    </div>
  );
}

/**
 * A1's START TIME row (round 26, item 1), inside the parsed card: the
 * hint, a time field, and **Get weather** — *"Refetch is our word, and the
 * runner's word is weather."* Focus moves to the field when it opens.
 */
function StartTimeRow({
  form,
  time,
  fileSaid,
  onTime,
}: Readonly<{
  form: ReturnType<typeof useRetimeForm>;
  time: string;
  fileSaid: string;
  onTime: (time: string) => void;
}>): JSX.Element {
  const hint = `The file said ${fileSaid}. Change it if your watch's clock was off.`;
  const error = form.fieldErrors.time;
  const field = form.field("time");
  return (
    <form
      ref={form.formRef}
      noValidate
      data-slot="start-time"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ time });
      }}
    >
      {/* `FormField` with its own input, as manual entry's start does:
          `TextField` takes text types only, and a time is picked. */}
      <FormField name="time" label="Start time" hint={hint} error={error}>
        <input
          {...field}
          // Its hint or its message, whichever shows: `field`'s own
          // pointer is only ever that message's id, so it is not passed on.
          aria-describedby={describedByFor("time", { hint, error })}
          ref={focusOnMount}
          id="time"
          type="time"
          value={time}
          onChange={(event) => {
            onTime(event.target.value);
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
        label="Get weather"
        pendingLabel="Getting"
        pending={form.pending}
      />
    </form>
  );
}

/**
 * The correction's form, with what a moved start and a start with no
 * weather each leave behind. Its own hook so the card can read `pending`
 * — the conditions block and the primary action both wait on it.
 */
function useRetimeForm({
  run,
  zone,
  retime,
  onMoved,
  onNoWeather,
}: Readonly<{
  run: RunSummary;
  zone: string | undefined;
  retime: Retime;
  onMoved: (startedAt: number) => void;
  onNoWeather: (time: string) => void;
}>) {
  const form = useFormSubmit({
    carry: "run",
    schema: retimeSchema,
    action: async (values) => {
      const startedAt = startAtTimeOfDay(run.startedAt, zone, values.time);
      const outcome = await retime({
        data: { runId: run.id, startedAt, timeZone: zone },
      });
      // Refused is the server saying no to a run this card should not be
      // able to ask about — another day, or not this runner's. A failure
      // like any other: nothing changed.
      if (outcome === "refused") throw new Error(outcome);
      return { outcome, startedAt };
    },
    // The sentence depends on the answer, so `onSuccess` says it.
    successMessage: "",
    onSuccess: ({ outcome, startedAt }) => {
      const asked = clockLabel(startedAt, zone);
      if (outcome === "moved") {
        form.announce(`Start time changed to ${asked}.`);
        onMoved(startedAt);
        return;
      }
      form.announce(
        `Still ${clockLabel(run.startedAt, zone)}. Couldn't get weather for ${asked}. Try again?`,
      );
      onNoWeather(asked);
    },
  });
  return form;
}

/**
 * A1 done: the parsed card and its conditions, in place (Product Screens
 * A1). *"The parsed card and conditions block appear together the moment
 * the file lands — one screen, no wizard step for weather."*
 *
 * **The start time is the one correction** (round 26, item 1). The time
 * on the stats line is a button, "6:04 AM, change start time"; it opens
 * the START TIME row in its place. While the weather for the new time is
 * fetched the conditions block says so, with what it was. On success the
 * row closes and the line reads "{t} · CHANGED"; on failure a band under
 * the block says `STILL {t0}`, and the server has put the time and the
 * conditions back. The date never changes. The primary action, pressed
 * mid-fetch, waits in brackets and then goes — never disabled.
 *
 * **At the desk the conditions block is the rail** (round 25): the card
 * and the primary action in the primary column, the block beside them,
 * read-only. Below 1040 it is where the phone has it, between the two.
 */
// fallow-ignore-next-line code-duplication -- a many-prop signature that matches feed/components/Feed.tsx FollowingTab only by destructuring one prop per line; one is a parsed run, the other the Following tab, and they share nothing to extract
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
  // The run's own zone, from its observation (R-96). With none — a
  // treadmill, no GPS, weather that never came — the runner's own clock,
  // which is the one they read the start from; never UTC, which would put
  // a Chicago evening run at the next morning. The card is drawn only after
  // a drop, in the browser, so the device's zone cannot split hydration.
  const zone = run.conditions?.timeZone ?? deviceTimeZone();
  const [isRetiming, setIsRetiming] = useState(false);
  const [time, setTime] = useState(timeOfDay(run.startedAt, zone));
  const [movedTo, setMovedTo] = useState<number | undefined>();
  const [noWeatherFor, setNoWeatherFor] = useState<string | undefined>();
  const form = useRetimeForm({
    run,
    zone,
    retime,
    onMoved: (startedAt) => {
      setMovedTo(startedAt);
      setNoWeatherFor(undefined);
      setIsRetiming(false);
      onRetimed();
    },
    onNoWeather: setNoWeatherFor,
  });
  const clock = clockLabel(movedTo ?? run.startedAt, zone);

  return (
    <div className="flex flex-col gap-3 desk:grid desk:grid-cols-[minmax(0,var(--container-column))_minmax(0,1fr)] desk:items-start desk:gap-x-6">
      <FormStatus>{form.status}</FormStatus>
      <div
        data-slot="parsed-card"
        data-state="parsed"
        className="overflow-hidden rounded-card border border-hairline bg-panel desk:col-start-1 desk:row-start-1"
      >
        <FileStrip
          label={`Parsed · ${filename}`}
          filename={filename}
          onReplace={onReplace}
        />
        <div className="flex flex-col gap-2 p-4">
          <Headline run={run} units={units} />
          <GarminAttribution deviceName={run.deviceName} />
          <Facts>
            {[
              paceCell(run, units),
              dayLabel(run.startedAt, zone),
              ...(isRetiming
                ? []
                : [
                    <TimeButton
                      key="time"
                      shown={
                        movedTo === undefined ? clock : `${clock} · Changed`
                      }
                      onPress={() => {
                        setIsRetiming(true);
                      }}
                    />,
                  ]),
            ]}
          </Facts>
          {isRetiming ? (
            <StartTimeRow
              form={form}
              time={time}
              fileSaid={clockLabel(run.startedAt, zone)}
              onTime={setTime}
            />
          ) : undefined}
        </div>
      </div>
      <div
        data-part="rail"
        className="flex flex-col gap-3 desk:col-start-2 desk:row-start-1 desk:row-span-3"
      >
        <RailConditions
          run={run}
          units={units}
          zone={zone}
          time={time}
          pending={form.pending}
        />
      </div>
      {/* The band says what is still true under the block, and holds Try
          again — a control, so in the primary column and never the rail. */}
      <div className="flex flex-col desk:col-start-1 desk:row-start-2">
        <ControlFailureBand
          failure={noWeatherFailure(noWeatherFor, run.startedAt, zone)}
          onRetry={() => {
            void form.submit({ time });
          }}
        />
      </div>
      <LooksRightAction runId={run.id} pending={form.pending} />
    </div>
  );
}

/**
 * While the weather is fetched the primary action is a button that
 * holds the runner's press, and a link again once it has settled —
 * so a press mid-fetch waits in brackets and then goes, and is
 * never disabled (round 26, item 1).
 *
 * The primary action pressed mid-fetch goes once the fetch has settled,
 * whichever way it went: the run is right either way — the new time with
 * its weather, or the old time with the old.
 */
function LooksRightAction({
  runId,
  pending,
}: Readonly<{ runId: string; pending: boolean }>): JSX.Element {
  const navigate = useNavigate();
  const [isWaitingToGo, setIsWaitingToGo] = useState(false);
  useEffect(() => {
    if (isWaitingToGo && !pending) {
      void navigate({ to: "/feed/attach/$runId", params: { runId } });
    }
  }, [isWaitingToGo, pending, navigate, runId]);
  return pending ? (
    <button
      type="button"
      data-slot="primary-action"
      onClick={() => {
        setIsWaitingToGo(true);
      }}
      className={`border-none ${PRIMARY_ACTION}`}
    >
      <PendingLabel
        label={LOOKS_RIGHT}
        pendingLabel={LOOKS_RIGHT}
        pending={isWaitingToGo}
      />
    </button>
  ) : (
    <Link
      to="/feed/attach/$runId"
      params={{ runId }}
      data-slot="primary-action"
      className={`no-underline ${PRIMARY_ACTION}`}
    >
      {LOOKS_RIGHT}
    </Link>
  );
}

/**
 * The conditions block, in the rail at the desk: while the weather for a
 * new start is fetched it says so, with what it was; otherwise the run's
 * conditions, never typed by hand.
 */
function RailConditions({
  run,
  units,
  zone,
  time,
  pending,
}: Readonly<{
  run: RunSummary;
  units: Units;
  zone: string | undefined;
  time: string;
  pending: boolean;
}>): JSX.Element {
  return pending ? (
    <WeatherFor
      time={clockLabel(startAtTimeOfDay(run.startedAt, zone, time), zone)}
      was={conditionsWords(run, units)}
      at={clockLabel(run.startedAt, zone)}
      isProviders={hasProvidersReading(run)}
    />
  ) : (
    <ConditionsRow
      run={run}
      units={units}
      note={
        <p className="m-0 text-small text-quiet">
          Never typed by hand. Wrong time? Change it on the run card and
          we&rsquo;ll get the weather for it.
        </p>
      }
    />
  );
}

/**
 * The band under the block when the new start had no weather: the time
 * still true, and what could not be fetched. None while nothing failed.
 */
function noWeatherFailure(
  noWeatherFor: string | undefined,
  startedAt: number,
  zone: string | undefined,
): ControlFailure | undefined {
  return noWeatherFor === undefined
    ? undefined
    : {
        kicker: `Still ${clockLabel(startedAt, zone)}`,
        message: `Couldn't get weather for ${noWeatherFor}. Try again?`,
      };
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
        <Spoken
          {...measuredLine(
            [
              [
                { kind: "temp", tempC: conditions.tempC, withLetter: true },
                { kind: "word", word: precipClassOf(conditions.precipMm) },
              ],
            ],
            units,
          )}
        />
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
        <FileStrip label={filename} filename={filename} onReplace={onReplace} />
        <div className="flex flex-col gap-2 p-4">
          <Mono step="xs" className="text-muted">
            Already logged
          </Mono>
          <Headline run={run} units={units} />
          <Facts>{facts}</Facts>
          {hasProvidersReading(run) ? <WeatherAttribution /> : undefined}
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
        Wrong file? Replace it.
      </p>
    </>
  );
}
