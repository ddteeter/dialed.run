import { monthDayLabel, monthYearLabel } from "../../lib/dates";

/**
 * The words inside a retired piece's tag — round 22's `[RETIRED SEP 12]`.
 * `Bracketed` supplies the brackets and the capitals, so the accessible
 * name stays "Retired Sep 12".
 *
 * The date is `lib/dates`' (STR-13): month first, three letters, in the
 * runner's zone — omitted or invalid, UTC, which is what the server
 * renders with and so what the first paint agrees on.
 *
 * **Undated when the date is unknown.** A piece retired before the column
 * existed has no `retired_at`; `[RETIRED]` is true of it, a guessed date
 * would not be.
 */
export function retiredLabel(
  retiredAt: number | null,
  timeZone: string | undefined,
): string {
  return retiredAt === null
    ? "Retired"
    : `Retired ${monthDayLabel(retiredAt, timeZone)}`;
}

/**
 * The same retirement on F's rail card, by **month and year** — round 28
 * #13's "RETIRED MAR 2026": retired gear is read across years there, and
 * the day does not matter. Everywhere else in the closet keeps
 * `retiredLabel`'s day. Undated for the same reason.
 */
export function retiredMonthLabel(
  retiredAt: number | null,
  timeZone: string | undefined,
): string {
  return retiredAt === null
    ? "Retired"
    : `Retired ${monthYearLabel(retiredAt, timeZone)}`;
}
