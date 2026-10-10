/**
 * The age gate (design 134, decision D-114): dialed.run is for runners 18
 * and over, asked at sign-up — the cut-off, the date field, the words and
 * the wire names, shared by Au2 and the server's gate
 * (`modules/auth/access-hook.ts`) so neither restates the other.
 *
 * **The form checks the date's shape, never the age.** The age is the
 * server's decision, and its refusal sets a cookie that holds for a day
 * (`AGE_REFUSED_COOKIE`), so Back and an earlier year does not get
 * through. The cut-off itself is no secret — Au2 says it under the form
 * (D-71's line) and the terms say it — so the field does not pretend to
 * be a neutral screen.
 *
 * **Nothing is kept.** The date is read by the gate and dropped: no column,
 * no log. An account existing is the record that it passed.
 */
import { z } from "zod";

import { nowSeconds } from "../now";

/**
The youngest a runner may be (owner, 2026-10-09).
*/
export const MINIMUM_AGE = 18;

/**
 * The earliest date the field takes. A year before it is a typo, not a
 * runner, and says so rather than passing as very old.
 */
const EARLIEST_BIRTH_DATE = "1900-01-01";

/**
 * Au2's line under the form (D-71, round 27 #12), and the refusal's words:
 * one sentence, so the page and the server never say different ages.
 */
export const AGE_LINE = `dialed.run is for runners ${String(MINIMUM_AGE)} and over.`;

/**
The words, one sentence each, naming the fix (§Forms & failure).
*/
export const AGE_COPY = {
  missing: "Enter your date of birth.",
  invalid: "Enter a real date.",
  year: "Check the year.",
  refused: AGE_LINE,
} as const;

/**
 * Today's date in UTC as `YYYY-MM-DD`, from epoch seconds. UTC rather than
 * the runner's zone: the gate runs on the server, and a birthday that
 * lands a few hours early or late on one day a year is not worth a zone.
 */
export function isoDayOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Whether someone born on `birthDate` is `MINIMUM_AGE` or over on `today`,
 * both `YYYY-MM-DD`. Comparing the dates as strings is exact for this
 * format, and it settles a 29 February birth without arithmetic: their
 * eighteenth "2026-02-29" sorts after "2026-02-28", so they pass on
 * 1 March in a year with no 29th.
 */
export function isOldEnough(birthDate: string, today: string): boolean {
  const year = Number(birthDate.slice(0, 4)) + MINIMUM_AGE;
  return `${String(year)}${birthDate.slice(4)}` <= today;
}

/**
 * The field, as Au2 and the server parse it: a real calendar date, from
 * 1900 to today. Its age is not checked here (see the module comment).
 */
export const birthDateField = z
  .string()
  .min(1, AGE_COPY.missing)
  .pipe(z.iso.date({ error: AGE_COPY.invalid, abort: true }))
  .refine(
    (date) => date >= EARLIEST_BIRTH_DATE && date <= isoDayOf(nowSeconds()),
    AGE_COPY.year,
  );

/**
 * The header sign-up carries the date in, beside the invite code
 * (`ACCESS_HEADERS`) and for the same reason: Better Auth's body is its own.
 */
export const BIRTH_DATE_HEADER = "x-birth-date";

/**
The codes the gate's refusals carry, which Au2 reads to place each one.
*/
export const AGE_CODES = {
  missing: "AGE_MISSING",
  refused: "AGE_REFUSED",
} as const;

/**
 * The cookie a refusal sets: while it is present the gate refuses whatever
 * date is typed, so Back and an earlier year does not get through. A day,
 * so a runner who mistyped their year is not shut out for long.
 */
export const AGE_REFUSED_COOKIE = "dialed_age_refused";
export const AGE_REFUSED_SECONDS = 24 * 60 * 60;
