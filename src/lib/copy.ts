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
 * that the deletion is confirmed. Each entry is one paragraph, in order,
 * and each paragraph is its runs: a `lead` is the run-in lead-in round 39
 * (#66) sets semibold at the paragraph's own size, so the lead-ins are
 * part of the words rather than a second list that names them.
 *
 * Owner-approved wording: change it only with the owner, and keep it true
 * to what `modules/runs/strava` actually stores — the athlete id, the
 * token kept only to revoke, and the 7-day webhook claim rows.
 */
export const STRAVA_CONSENT: readonly (readonly ConsentRun[])[] = [
  [{ text: "Connecting Strava lets us remind you to log a kit after each run." }],
  [
    {
      lead: "What we collect:",
      text: "your Strava athlete id, a token we use only to disconnect, and, for 7 days, the id, type and time of each new activity so we remind you once.",
    },
    {
      lead: "How:",
      text: "through Strava's sign-in and its activity notifications.",
    },
    {
      lead: "Never:",
      text: "your activity details, route, pace or anything else about the run.",
    },
  ],
  [
    {
      lead: "To stop:",
      text: "Disconnect in Settings, or remove dialed.run under Strava › Settings › My Apps. Either deletes what we hold from Strava, apart from what we need to finish disconnecting, and we email you to confirm it.",
    },
  ],
];

/**
One run of a consent paragraph: an optional run-in lead-in, then its text.
*/
export interface ConsentRun {
  readonly lead?: string;
  readonly text: string;
}

/**
 * A run as it reads: its lead-in and its text, one space between. The
 * paragraph is its runs read in order, one space between.
 */
export function consentRunText(run: ConsentRun): string {
  return run.lead === undefined ? run.text : `${run.lead} ${run.text}`;
}

/**
The paragraph as one sentence string, which is what a runner reads.
*/
export function stravaConsentText(paragraph: readonly ConsentRun[]): string {
  return paragraph.map((run) => consentRunText(run)).join(" ");
}

/**
 * The outbox running behind (design 168): the one sentence Today's line
 * and the morning digest both say, owner-approved 2026-10-31. Each adds
 * its own second sentence.
 */
export function outboxBehindSentence(rows: number): string {
  const jobs = rows === 1 ? "queued job was" : "queued jobs were";
  return `${String(rows)} ${jobs} still due after this morning's run.`;
}
