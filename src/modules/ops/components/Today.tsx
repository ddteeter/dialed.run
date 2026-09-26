import type { ReactNode } from "react";

import { Mono } from "../../../ui";
import type { DeskToday } from "../desk";

/**
 * Today (Operator Screens D0): "the digest, rendered. Same three numbers,
 * same order. Nothing on this page is a chart." The numbers come from
 * `todayCounts`, the query the daily digest reads too (D5), so the page
 * and the digest cannot disagree.
 *
 * Hi-viz marks a number that needs a person, and only when it is above
 * zero; bans are a record, not a task, so they are never hi-viz.
 */

const HOUR_SECONDS = 3600;

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
  const tone = needsPerson && count > 0 ? "text-hi-viz" : "text-ink";
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

export function Today({ today }: Readonly<{ today: DeskToday }>) {
  const { counts, asOf } = today;
  const oldest =
    counts.oldestWaitingAt === undefined
      ? "Nothing waiting"
      : `Oldest · ${String(Math.floor((asOf - counts.oldestWaitingAt) / HOUR_SECONDS))}h`;
  return (
    <section aria-labelledby="desk-today" className="flex flex-col gap-8">
      <h1 id="desk-today" className="font-display text-title uppercase">
        {dayOf(asOf)}
      </h1>
      <ul className="flex flex-col gap-6">
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
  );
}
