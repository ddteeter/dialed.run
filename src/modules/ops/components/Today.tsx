import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { GaveUpKind } from "../../../lib/contracts/gave-up";
import { monthDayLabel, timeOfDay } from "../../../lib/dates";
import {
  ControlFailureBand,
  FormStatus,
  Mono,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import type { DeskToday } from "../desk";
import { DeskShell } from "./DeskShell";
import type { GaveUpJob } from "../gave-up";

/**
 * Today (Operator Screens D0): "the digest, rendered. Same three numbers,
 * same order. Nothing on this page is a chart." The numbers come from
 * `todayCounts`, the query the daily digest reads too (D5), so the page
 * and the digest cannot disagree.
 *
 * Under them, Gave up (D-87; round 29 B·2, D6's rows): the jobs the system
 * stopped retrying. Today's three numbers stay three — Gave up is its own
 * section, and its count is the rail's on Today.
 *
 * Hi-viz marks a number that needs a person, and only when it is above
 * zero; bans are a record, not a task, so they are never hi-viz.
 */

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/**
How many Gave up rows show before "Show all" (round 29 B·2: "the two newest").
*/
const FIRST_SHOWN = 2;

/**
 * The date the counts were read on, US order (round 26 #9): "Tuesday,
 * Sep 16". In UTC, the digest's own day, so the server's render and the
 * hydrated one agree whatever the operator's zone.
 */
function dayOf(asOf: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(asOf * 1000));
}

function Stat({
  count,
  needsPerson,
  children,
  note,
}: Readonly<{
  count: number;
  needsPerson: boolean;
  children: ReactNode;
  note: ReactNode;
}>) {
  const tone = needsPerson && count > 0 ? "text-hiviz-text" : "text-ink";
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-baseline gap-3">
        <Mono step="lg" className={tone}>
          {count}
        </Mono>
        <span className="text-lead">{children}</span>
      </span>
      <Mono step="xs" className="text-muted">
        {note}
      </Mono>
    </li>
  );
}

/**
 * How long, in the board's largest whole unit: "45m", "6h", "2d". Under
 * a minute is "0m": an age, not a claim that nothing has passed.
 */
export function spanOf(seconds: number): string {
  if (seconds >= DAY_SECONDS) {
    return `${String(Math.floor(seconds / DAY_SECONDS))}d`;
  }
  if (seconds >= HOUR_SECONDS) {
    return `${String(Math.floor(seconds / HOUR_SECONDS))}h`;
  }
  return `${String(Math.floor(Math.max(0, seconds) / MINUTE_SECONDS))}m`;
}

/**
 * When a job last failed: the time alone on the Desk's own day ("04:12"),
 * the date with it on any other ("Sep 15 22:40"). UTC, as the date at the
 * top of the page is.
 */
export function lastTryOf(at: number, asOf: number): string {
  const time = timeOfDay(at);
  const isToday = monthDayLabel(at) === monthDayLabel(asOf);
  return isToday ? time : `${monthDayLabel(at)} ${time}`;
}

/**
 * What each job is called in its row's caption. "Conditions" is the UI
 * lexicon's word for weather.
 */
const KIND_LABEL: Readonly<Record<GaveUpKind, string>> = {
  enrichment: "Enrichment",
  weather: "Conditions",
  import: "Import",
  reminder: "Reminder",
};

/**
The board's two control treatments: a pill for a retry, bare text for Drop.
*/
const PILL =
  "cursor-pointer rounded-pill border border-hairline-2 px-4 py-2 text-ink";
const PILL_UNAVAILABLE =
  "cursor-default rounded-pill border border-hairline px-4 py-2 text-muted";
const BARE = "cursor-pointer px-2 py-2 text-muted";

type Retry = (input: {
  data: { id: string; step: "again" | "extract" };
}) => Promise<unknown>;
type Drop = (input: { data: { id: string } }) => Promise<unknown>;

/**
 * One press on a row: which row and which control, so its label breathes
 * and its band shows under that row only.
 */
interface Press {
  readonly id: string;
  readonly control: "again" | "extract" | "drop";
}

function JobControl({
  label,
  pendingLabel,
  pending,
  className,
  unavailable = false,
  onPress,
}: Readonly<{
  label: string;
  pendingLabel: string;
  pending: boolean;
  className: string;
  unavailable?: boolean;
  onPress: () => void;
}>) {
  const busy = inFlight(pending);
  return (
    <button
      type="button"
      className={`target ${className}`}
      {...busy}
      aria-disabled={unavailable || busy["aria-disabled"]}
      onClick={() => {
        if (!unavailable) onPress();
      }}
    >
      <Mono step="sm">
        <PendingLabel
          label={label}
          pendingLabel={pendingLabel}
          pending={pending}
        />
      </Mono>
    </button>
  );
}

interface JobRowProps {
  readonly job: GaveUpJob;
  readonly asOf: number;
  /**
  The press still waiting on the server, on whichever row: none at rest.
  */
  readonly inFlight: Press | undefined;
  readonly band: ReactNode;
  readonly onPress: (control: Press["control"]) => void;
}

function JobRow({ job, asOf, inFlight, band, onPress }: JobRowProps) {
  const isPending = (control: Press["control"]) =>
    inFlight?.id === job.id && inFlight.control === control;
  const tries = job.tries === 1 ? "1 try" : `${String(job.tries)} tries`;
  const isEnrichment = job.kind === "enrichment";
  return (
    <li className="flex flex-col gap-3 border-t border-hairline py-4">
      <span className="flex items-baseline gap-4">
        <Mono step="xs" className="text-hiviz-text">
          {KIND_LABEL[job.kind]}
        </Mono>
        <Mono step="xs" className="text-muted">
          {`${spanOf(asOf - job.firstFailedAt)} ago`}
        </Mono>
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-semibold">{job.doing}</span>
        <span className="text-quiet">{job.reason}</span>
        <Mono step="xs" className="text-muted">
          {`${tries} · last ${lastTryOf(job.lastFailedAt, asOf)}`}
        </Mono>
        {job.rawError === undefined ? undefined : (
          <details>
            <summary className="target cursor-pointer">
              <Mono step="xs" className="text-muted">
                Raw error
              </Mono>
            </summary>
            <Mono step="md" className="text-quiet">
              {job.rawError}
            </Mono>
          </details>
        )}
      </span>
      <span className="flex flex-wrap gap-2">
        <JobControl
          label={isEnrichment ? "Re-fetch page" : "Retry"}
          pendingLabel={isEnrichment ? "Re-fetching" : "Retrying"}
          pending={isPending("again")}
          className={PILL}
          onPress={() => {
            onPress("again");
          }}
        />
        {isEnrichment ? (
          <JobControl
            label="Re-run extraction"
            pendingLabel="Re-running"
            pending={isPending("extract")}
            className={job.hasStoredPage ? PILL : PILL_UNAVAILABLE}
            unavailable={!job.hasStoredPage}
            onPress={() => {
              onPress("extract");
            }}
          />
        ) : undefined}
        <JobControl
          label="Drop"
          pendingLabel="Dropping"
          pending={isPending("drop")}
          className={BARE}
          onPress={() => {
            onPress("drop");
          }}
        />
      </span>
      {band}
    </li>
  );
}

/**
 * Gave up, under Today's three numbers (round 29 B·2): the two newest
 * jobs, then "+ N more · Show all", which expands in place. At zero the
 * section is one line. A retry or a drop waits for the server (never
 * optimistic, round 23 #9) and then reloads the page's data, which is
 * what takes the row away.
 */
interface GaveUpProps {
  readonly jobs: readonly GaveUpJob[];
  readonly count: number;
  readonly oldestAt: number | undefined;
  readonly asOf: number;
  readonly retry: Retry;
  readonly drop: Drop;
  readonly onChanged: () => Promise<void>;
}

function GaveUp({
  jobs,
  count,
  oldestAt,
  asOf,
  retry,
  drop,
  onChanged,
}: GaveUpProps) {
  const [isExpanded, setExpanded] = useState(false);
  const [pressed, setPressed] = useState<Press>();
  const action = useControlAction<[Press]>({
    kicker: "Still here",
    action: async (press) => {
      await (press.control === "drop"
        ? drop({ data: { id: press.id } })
        : retry({ data: { id: press.id, step: press.control } }));
      await onChanged();
    },
  });
  const shown = isExpanded ? jobs : jobs.slice(0, FIRST_SHOWN);
  const more = count - shown.length;
  const oldest =
    oldestAt === undefined ? "" : ` · oldest ${spanOf(asOf - oldestAt)}`;
  return (
    <section aria-labelledby="desk-gave-up" className="flex flex-col gap-3">
      <span className="flex items-baseline gap-4">
        <h2 id="desk-gave-up" className="m-0 font-display text-heading">
          Gave up
        </h2>
        {count === 0 ? undefined : (
          <Mono step="sm" className="text-hiviz-text">
            {`[${String(count)} ${count === 1 ? "job" : "jobs"}${oldest}]`}
          </Mono>
        )}
      </span>
      <FormStatus>{action.status}</FormStatus>
      {count === 0 ? (
        <p className="m-0 text-muted">Nothing gave up.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {shown.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              asOf={asOf}
              inFlight={action.pending ? pressed : undefined}
              band={
                pressed?.id === job.id ? (
                  <ControlFailureBand
                    failure={action.failure}
                    onRetry={action.retry}
                    retryRef={action.retryRef}
                  />
                ) : undefined
              }
              onPress={(control) => {
                const press = { id: job.id, control };
                setPressed(press);
                void action.run(press);
              }}
            />
          ))}
        </ul>
      )}
      {!isExpanded && more > 0 ? (
        <button
          type="button"
          className="target cursor-pointer self-start border-t border-hairline pt-3 text-muted"
          onClick={() => {
            setExpanded(true);
          }}
        >
          <Mono step="sm">{`+ ${String(more)} more · Show all`}</Mono>
        </button>
      ) : undefined}
    </section>
  );
}

export function Today({
  today,
  gaveUp,
  retry,
  drop,
  onChanged,
}: Readonly<{
  today: DeskToday;
  gaveUp: readonly GaveUpJob[];
  retry: Retry;
  drop: Drop;
  /**
  Reloads the page's data after a retry or a drop.
  */
  onChanged: () => Promise<void>;
}>) {
  const { counts, asOf } = today;
  const oldest =
    counts.oldestWaitingAt === undefined
      ? "Nothing waiting"
      : `Oldest · ${String(Math.floor((asOf - counts.oldestWaitingAt) / HOUR_SECONDS))}h`;
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="desk-today" className="flex flex-col gap-8">
        <h1 id="desk-today" className="font-display text-title uppercase">
          {dayOf(asOf)}
        </h1>
        <ul aria-label="Today" className="flex flex-col gap-6">
          <Stat count={counts.waiting} needsPerson note={oldest}>
            waiting for a decision
          </Stat>
          <Stat
            count={counts.screenerUnfinished}
            needsPerson
            note="Hidden until you look"
          >
            {counts.screenerUnfinished === 1 ? "photo" : "photos"} the screener
            couldn't finish
          </Stat>
          <Stat
            count={counts.bansThisWeek}
            needsPerson={false}
            note={`${String(counts.bansAllTime)} all time`}
          >
            {counts.bansThisWeek === 1 ? "ban" : "bans"} this week
          </Stat>
        </ul>
      </section>
      <GaveUp
        jobs={gaveUp}
        count={counts.gaveUp}
        oldestAt={counts.oldestGaveUpAt}
        asOf={asOf}
        retry={retry}
        drop={drop}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * The `/desk` page itself: Today inside the Desk's shell, reloading the
 * route's data after a retry or a drop. Here rather than in the route,
 * which may only wire (`server-functions-are-glue`).
 */
export function DeskTodayPage({
  today,
  gaveUp,
  retry,
  drop,
}: Readonly<{
  today: DeskToday;
  gaveUp: readonly GaveUpJob[];
  retry: Retry;
  drop: Drop;
}>) {
  const router = useRouter();
  return (
    <DeskShell current="today" today={today}>
      <Today
        today={today}
        gaveUp={gaveUp}
        retry={retry}
        drop={drop}
        onChanged={() => router.invalidate()}
      />
    </DeskShell>
  );
}
