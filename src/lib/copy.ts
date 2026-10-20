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

/**
 * What a runner reads before the Connect with Strava button, on every
 * screen that draws it (owner, 2026-10-18; D-143). Strava's API Policy §2.1
 * (1 June 2026) asks for consent, before the OAuth redirect, that says
 * what is collected, how, how to withdraw, how to ask for deletion, and
 * that the deletion is confirmed. Each entry is one paragraph, in order.
 *
 * Owner-approved wording: change it only with the owner, and keep it true
 * to what `modules/runs/strava` actually stores — the athlete id, the
 * token kept only to revoke, and the 7-day webhook claim rows.
 */
export const STRAVA_CONSENT: readonly string[] = [
  "Connecting Strava lets us remind you to log a kit after each run.",
  "What we collect: your Strava athlete id, a token we use only to disconnect, and, for 7 days, the id, type and time of each new activity so we remind you once. How: through Strava's sign-in and its activity notifications. Never: your activity details, route, pace or anything else about the run.",
  "To stop: Disconnect in Settings, or remove dialed.run under Strava › Settings › My Apps. Either deletes what we hold at once, and we email you to confirm it.",
];
