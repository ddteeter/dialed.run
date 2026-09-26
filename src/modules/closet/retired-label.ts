import { isTimeZone } from "../../lib/dates";

/**
 * The words inside a retired piece's tag — round 22's `[RETIRED SEP 12]`.
 * `Bracketed` supplies the brackets and the capitals, so the accessible
 * name stays "Retired Sep 12".
 *
 * **Month first, three letters, as the frame draws it** — not `en-GB`'s
 * "12 Sept", which is the locale's order and September's four-letter
 * abbreviation (`lib/dates.ts` records the same trap). Each field is
 * formatted alone for the same reason that file gives: `.format()` on a
 * one-field formatter always answers, so there is no fallback to write.
 *
 * **Undated when the date is unknown.** A piece retired before the column
 * existed has no `retired_at`; `[RETIRED]` is true of it, a guessed date
 * would not be.
 *
 * `timeZone` is the runner's; omitted or invalid, it is UTC, which is what
 * the server renders with and so what the first paint agrees on.
 */
export function retiredLabel(
  retiredAt: number | null,
  timeZone: string | undefined,
): string {
  if (retiredAt === null) return "Retired";
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const at = new Date(retiredAt * 1000);
  const month = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    month: "short",
  })
    .format(at)
    .slice(0, 3);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
  }).format(at);
  return `Retired ${month} ${day}`;
}
