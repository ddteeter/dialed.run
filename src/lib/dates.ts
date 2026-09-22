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
 * So the locale and the zone are pinned rather than asked for. `en-GB`
 * because it is what the board draws — "Mon 2 Sep", not "Mon, Sep 2" — and
 * the formatters are module-scope constants because `Intl.DateTimeFormat`
 * is expensive to construct and these run per row.
 *
 * **The honest limitation, which is D-96 and not fixed here**: this is the
 * UTC day, not the runner's. The app stores no timezone for anybody, so no
 * server render can know one. A late-evening run at a negative offset
 * still reads as the next day — deterministically, in both runtimes, which
 * is the difference between a wrong date and a flickering one. The real
 * fix is the run's own zone, which Visual Crossing already returns and
 * `visualCrossingResponseSchema` currently strips; that is a schema change
 * and belongs to its own PR.
 */
const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
});
const DAY_OF_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
});
const MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
});
/**
 * `hourCycle: "h23"` rather than `hour12: false`, which is the same thing
 * everywhere it matters and not the same thing at midnight: `hour12:
 * false` is specified to allow the h24 cycle, where 00:00 renders as
 * "24:00". Current ICU gives "00:00" for both, so nothing here would have
 * caught it — this is a guard against the engine, not a fix for it.
 */
const TIME_OF_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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
 * - **Order is the board's, not the locale's.** "Mon 21 Sep" is drawn;
 *   asking a locale to order the parts makes the layout a property of a
 *   locale tag, which is the class of thing this file exists to stop
 *   depending on.
 * - **`formatToParts` needs a fallback that can never fire.** Looking each
 *   field up by type gives `string | undefined`, so the code carries a
 *   `?? ""` for a case the formatter's own options rule out — dead code
 *   the compiler demands and no test can reach. `.format()` on a
 *   single-field formatter returns a `string`, so there is nothing to fall
 *   back from and the mutant cannot exist. Restructuring beat granting it.
 */
export function dayLabel(epochSeconds: number): string {
  const at = new Date(epochSeconds * 1000);
  return `${WEEKDAY.format(at)} ${DAY_OF_MONTH.format(at)} ${MONTH.format(at).slice(0, 3)}`;
}

/**
 * A day and the time on it — "Mon 2 Sep, 14:30".
 *
 * For a notification, where the time of day is the point: two notifications
 * on the same day are otherwise indistinguishable in a list sorted by it.
 */
export function dayTimeLabel(epochSeconds: number): string {
  return `${dayLabel(epochSeconds)}, ${TIME_OF_DAY.format(new Date(epochSeconds * 1000))}`;
}
