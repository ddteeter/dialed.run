/**
 * User-facing strings used in more than one place.
 *
 * Not i18n, and deliberately not a framework: this is a US-first product
 * with no second locale planned, and a key-management burden buys nothing
 * today. What it does buy is that the same sentence cannot drift into two
 * slightly different sentences, which is a real cost now — "That didn't
 * work. Try again." was already written out five times across auth and
 * runs, twice within a single file.
 *
 * The rule (docs/pr-self-review.md q7): copy that appears twice gets a
 * name. Copy that appears once stays where it is read.
 *
 * If i18n ever does land, these are the extraction points and the work is
 * already done.
 */

/**
A failed action the user can simply retry.
*/
export const RETRY_GENERIC = "That didn't work. Try again.";

/**
A failed *save*, where the user's input is still on screen.
*/
export const RETRY_SAVE = "That didn't save. Try again.";
