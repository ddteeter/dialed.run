import { isTimeZone } from "../../lib/dates";

/**
 * One field of a retirement date, in the runner's zone.
 *
 * Each field is formatted alone, for the reason `lib/dates.ts` gives:
 * `.format()` on a one-field formatter always answers, so there is no
 * fallback to write. `timeZone` is the runner's; omitted or invalid, it is
 * UTC, which is what the server renders with and so what the first paint
 * agrees on.
 */
function field(
  retiredAt: number,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: isTimeZone(timeZone) ? timeZone : "UTC",
    ...options,
  }).format(new Date(retiredAt * 1000));
}

/**
 * **Month first, three letters, as the frames draw it** — not `en-GB`'s
 * "Sept", which is September's four-letter abbreviation (`lib/dates.ts`
 * records the same trap).
 */
function month(retiredAt: number, timeZone: string | undefined): string {
  return field(retiredAt, timeZone, { month: "short" }).slice(0, 3);
}

/**
 * Shared by both labels below: "Retired" alone when the date is unknown,
 * otherwise "Retired <month> <unit>" where `unit` is whatever the caller
 * asks `field()` to format (day or year) alongside the month.
 */
function retiredWith(
  retiredAt: number | null,
  timeZone: string | undefined,
  unitOptions: Intl.DateTimeFormatOptions,
): string {
  if (retiredAt === null) return "Retired";
  const unit = field(retiredAt, timeZone, unitOptions);
  return `Retired ${month(retiredAt, timeZone)} ${unit}`;
}

/**
 * The words inside a retired piece's tag — round 22's `[RETIRED SEP 12]`.
 * `Bracketed` supplies the brackets and the capitals, so the accessible
 * name stays "Retired Sep 12".
 *
 * **Undated when the date is unknown.** A piece retired before the column
 * existed has no `retired_at`; `[RETIRED]` is true of it, a guessed date
 * would not be.
 */
export function retiredLabel(
  retiredAt: number | null,
  timeZone: string | undefined,
): string {
  return retiredWith(retiredAt, timeZone, { day: "numeric" });
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
  return retiredWith(retiredAt, timeZone, { year: "numeric" });
}
