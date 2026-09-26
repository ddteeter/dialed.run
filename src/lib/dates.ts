/**
 * Every date the app renders, formatted the same way in both runtimes.
 *
 * **This exists because a date is asked a question that has two answers.**
 * `toLocaleDateString()` and `toLocaleString()` ask the *runtime* for its
 * locale and zone. This app renders each screen twice — once in workerd,
 * which answers UTC, and once in the browser, which answers the runner's
 * zone — so the same epoch formatted to different text in each, React
 * found the mismatch on hydration and discarded the whole subtree. The dev
 * server reported it as *"the server rendered text didn't match the
 * client"*, and it is visible to a user as a date that changes after the
 * page loads.
 *
 * It is also easy to miss, because it is only wrong near a day boundary.
 * The demo re-record that found it ran at ten past midnight local, when
 * UTC had already turned over: server `9/21/2026`, client `9/22/2026`.
 * An afternoon run would have agreed and the bug would have stayed hidden.
 *
 * So the locale and the zone are pinned rather than asked for. The parts
 * come from `en-GB`; the **order is US**, month before day (design round
 * 26, item 9): "SAT AUG 29" as a mono label and "Sat, Aug 29" in prose.
 * "Sat 29 Aug" is wrong for an en-US reader.
 *
 * **The zone is the run's own, when we know it** (D-96). A run's date is
 * where the run happened — a Chicago run viewed from Berlin is still a
 * Chicago run — and Visual Crossing names the zone on every observation,
 * which is now stored. Passed explicitly, it gives the same text in both
 * runtimes, so hydration still agrees. Without one — an indoor run, a
 * manual temperature, an observation cached before the column existed —
 * the answer is UTC, deterministically, which is the difference between a
 * wrong date and a flickering one.
 *
 * A formatter is built per call rather than cached per zone. A cache would
 * be a branch whose miss produces the same text as its hit — a mutant no
 * test can kill — and building one costs microseconds against a table of
 * fifty rows.
 */
/**
 * Is this a zone `Intl` will accept?
 *
 * The zone arrives from a third party and is stored, so it is untrusted
 * twice over — and an invalid one does not fail at the boundary, it throws
 * a `RangeError` inside `Intl` at render time, on every screen that shows
 * the run. So it is checked where it enters and again where it is used.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // `Intl` is the judge, and it is complete: it throws a RangeError for an
  // empty string as well as for an unknown zone, and a successful
  // construction always resolves to a named zone. An empty-string guard
  // and a check on the resolved name both used to sit here, measured
  // redundant against exactly those two facts — and both showed up as
  // mutants nothing could kill, which is how redundant code announces
  // itself.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function zoneOf(timeZone: string | undefined): string {
  return isTimeZone(timeZone) ? timeZone : "UTC";
}

function part(
  epochSeconds: number,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zoneOf(timeZone),
    ...options,
  }).format(new Date(epochSeconds * 1000));
}

/**
 * One formatter per field, assembled here rather than by the locale.
 *
 * Three reasons, the first two learned by asserting an exact string and
 * being wrong, the third by a surviving mutant:
 *
 * - **The month is three letters on the board, and `en-GB` gives four for
 *   September.** "Sept" is a perfectly good British abbreviation and it is
 *   not what the artboards draw; September is the only month where the two
 *   disagree, which is exactly the kind of difference that survives review
 *   and then looks like a typo in one row of a table.
 * - **Order is the ruling's, not the locale's.** Month before day, "Mon
 *   Sep 21" (round 26, item 9); asking a locale to order the parts makes
 *   the layout a property of a locale tag, which is the class of thing
 *   this file exists to stop depending on.
 * - **`formatToParts` needs a fallback that can never fire.** Looking each
 *   field up by type gives `string | undefined`, so the code carries a
 *   `?? ""` for a case the formatter's own options rule out — dead code
 *   the compiler demands and no test can reach. `.format()` on a
 *   single-field formatter returns a `string`, so there is nothing to fall
 *   back from and the mutant cannot exist. Restructuring beat granting it.
 *
 * `timeZone` is the run's own (D-96); omitted or invalid, it is UTC.
 */
function dayParts(
  epochSeconds: number,
  timeZone: string | undefined,
): { weekday: string; month: string; day: string } {
  return {
    weekday: part(epochSeconds, timeZone, { weekday: "short" }),
    month: part(epochSeconds, timeZone, { month: "short" }).slice(0, 3),
    day: part(epochSeconds, timeZone, { day: "numeric" }),
  };
}

/**
 * The day as a mono label draws it — "Sat Aug 29", which the mono step's
 * CSS sets as "SAT AUG 29". No comma: a label is a row of cells.
 */
export function dayLabel(epochSeconds: number, timeZone?: string): string {
  const { weekday, month, day } = dayParts(epochSeconds, timeZone);
  return `${weekday} ${month} ${day}`;
}

/**
 * The day as a sentence says it — "Sat, Aug 29", with the comma en-US
 * prose puts after the weekday.
 */
export function proseDayLabel(epochSeconds: number, timeZone?: string): string {
  const { weekday, month, day } = dayParts(epochSeconds, timeZone);
  return `${weekday}, ${month} ${day}`;
}

/**
 * A day and the time on it — "Mon Sep 2, 14:30".
 *
 * For a notification, where the time of day is the point: two notifications
 * on the same day are otherwise indistinguishable in a list sorted by it.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, which is the same thing
 * everywhere it matters and not the same thing at midnight: `hour12: false`
 * is specified to allow the h24 cycle, where 00:00 renders as "24:00".
 * Current ICU gives "00:00" for both, so nothing here would have caught it
 * — this is a guard against the engine, not a fix for it.
 */
export function dayTimeLabel(epochSeconds: number, timeZone?: string): string {
  const time = part(epochSeconds, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dayLabel(epochSeconds, timeZone)}, ${time}`;
}

/**
 * The time of day on the board's clock — "6:04 AM".
 *
 * A3's header and A1's parsed card both draw a twelve-hour time beside the
 * day ("SAT AUG 29 · 6:04 AM"), where a notification's `dayTimeLabel`
 * draws 24-hour. Upper-cased here rather than left to the mono step's CSS,
 * because `en-GB` writes "am" and a screen reader should hear the letters
 * the eye sees.
 *
 * `timeZone` is the run's own (D-96); omitted or invalid, it is UTC.
 */
export function clockLabel(epochSeconds: number, timeZone?: string): string {
  return part(epochSeconds, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).toUpperCase();
}

/**
 * The time of day as a time input writes it — "06:04", 24-hour — so A1's
 * time correction can start from the run's own clock.
 */
export function timeOfDay(epochSeconds: number, timeZone?: string): string {
  return part(epochSeconds, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function minutesOf(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The start that reads `hhmm` on the same clock — the one the runner was
 * looking at, in the zone they were looking at it in.
 *
 * An absolute epoch, not a shift, so sending it twice is sending the same
 * fact twice: a retry after a lost response moves the run to the time
 * picked, where a shift would have moved it by that much again. The
 * arithmetic is still a difference between two times on one clock, so it
 * needs no zone rules to be right. The day does not change — a run that
 * started on another day is another run.
 */
export function startAtTimeOfDay(
  epochSeconds: number,
  timeZone: string | undefined,
  hhmm: string,
): number {
  return (
    epochSeconds +
    (minutesOf(hhmm) - minutesOf(timeOfDay(epochSeconds, timeZone))) * 60
  );
}

/**
 * The zone this device's clock reads in, or none if `Intl` names one it
 * would not accept back.
 *
 * **Only for what renders after a runner's own action**, never for first
 * paint: workerd answers UTC and the browser answers the runner's zone, so
 * text built from this on the server would not match the client's
 * (see the note at the top of this file). A1's parsed card is drawn only
 * once a file has been dropped, in the browser, which is why it may use it
 * for a run with no zone of its own — the runner's clock, rather than UTC,
 * is the one they read the start time from.
 */
export function deviceTimeZone(): string | undefined {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : undefined;
}
