import { dayLabel, isTimeZone } from "../../lib/dates";

/**
 * When a post's run happened, as E1's author line says it: `2h ago · 6:04
 * AM`, `Yesterday · 5:40 PM`, `Mon · 7:15 PM` (round 22, "E1v1
 * Following"). Uppercase is the mono step's, in CSS, so the text stays in
 * normal case for a screen reader.
 *
 * The three shapes the frame draws, and one it implies:
 *
 * - **Earlier today** — how long ago, in whole hours (minutes inside the
 *   first hour, where "0h ago" would be wrong).
 * - **Yesterday** — by the calendar, not by 24 hours: a run at 11pm seen
 *   at 7am is yesterday's, and "8h ago" would hide that.
 * - **This week** — the weekday.
 * - **Older** — the date, as every other date in the app reads.
 *
 * **`now` is an argument**, never read here. The screen renders on the
 * server and again in the browser; a relative label computed from two
 * different clocks can disagree across an hour boundary, and React throws
 * the subtree away when it does. The route's loader reads the clock once
 * and both renders use that.
 *
 * Days are counted in the run's own zone (D-96), the same one its time is
 * printed in, so "yesterday" and "6:04 AM" can never be about two
 * different places. No zone means UTC, as it does in `lib/dates`.
 */
const HOUR = 3600;
const DAY = 24 * HOUR;
const WEEK_DAYS = 7;

function zoneOf(timeZone: string | undefined): string {
  return isTimeZone(timeZone) ? timeZone : "UTC";
}

/**
The calendar day an instant falls on in a zone, as a day number.
*/
function dayNumber(epochSeconds: number, timeZone: string): number {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
  return Date.parse(`${date}T00:00:00Z`) / (DAY * 1000);
}

function whenLabel(
  epochSeconds: number,
  nowEpochSeconds: number,
  timeZone: string,
): string {
  const ago = nowEpochSeconds - epochSeconds;
  const daysBack =
    dayNumber(nowEpochSeconds, timeZone) - dayNumber(epochSeconds, timeZone);
  if (daysBack === 0) {
    return ago < HOUR
      ? `${String(Math.max(1, Math.floor(ago / 60)))}m ago`
      : `${String(Math.floor(ago / HOUR))}h ago`;
  }
  if (daysBack === 1) return "Yesterday";
  if (daysBack < WEEK_DAYS) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
    }).format(new Date(epochSeconds * 1000));
  }
  return dayLabel(epochSeconds, timeZone);
}

/**
 * The time of day on a 12-hour clock, as E1 and D draw it: `6:04 AM`.
 *
 * `en-US` for the 12-hour clock. Current ICU puts a narrow no-break space
 * before "AM"; it is folded to a plain one so a label is one kind of
 * space throughout.
 */
function clockIn(epochSeconds: number, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(epochSeconds * 1000))
    .replaceAll("\u{202F}", " ");
}

export function postedLabel(
  epochSeconds: number,
  nowEpochSeconds: number,
  timeZone?: string,
): string {
  const zone = zoneOf(timeZone);
  return `${whenLabel(epochSeconds, nowEpochSeconds, zone)} · ${clockIn(epochSeconds, zone)}`;
}

/**
 * When a run was, absolutely — D's run strip: `Tue 22 Sep · 6:30 AM`.
 * The day as every other date in the app reads, the time as E1's.
 */
export function runWhenLabel(epochSeconds: number, timeZone?: string): string {
  const zone = zoneOf(timeZone);
  return `${dayLabel(epochSeconds, zone)} · ${clockIn(epochSeconds, zone)}`;
}
