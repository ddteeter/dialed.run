/**
 * The cron registry: schedule -> handler name, in one place.
 *
 * Cloudflare gives a scheduled handler exactly one identifying field —
 * `ScheduledController.cron`, the literal expression from wrangler.jsonc.
 * There is no custom id to attach, so matching on the expression is not a
 * shortcut, it is the only mechanism the platform offers.
 *
 * What *was* dangerous is that the expression was a bare string literal in
 * the handler and a separate string in wrangler.jsonc, with nothing tying
 * them together: re-tuning a schedule in the (human-managed) config sent
 * every firing to the `unknown` branch, and the cron went quiet with only a
 * Sentry breadcrumb to show for it — a silent permanent failure, which
 * CLAUDE.md calls a bug outright.
 *
 * So the registry is the source of truth and test/crons.test.ts asserts it
 * against wrangler.jsonc. A schedule edited in one place and not the other
 * now fails CI instead of failing in production at 12:00 UTC.
 */

const cronRegistry = [
  { schedule: "0 12 * * *", name: "daily-digest" },
] as const;

export type CronName = (typeof cronRegistry)[number]["name"];

/**
Every schedule the worker expects to be registered, for the conformance test.
*/
export const cronSchedules: readonly string[] = cronRegistry.map(
  (entry) => entry.schedule,
);

/**
 * The handler name for a fired schedule, or `undefined` when the platform
 * delivered one this build does not know about (a config/code skew the
 * conformance test is meant to have caught first).
 */
export function cronNameFor(cron: string): CronName | undefined {
  return cronRegistry.find((entry) => entry.schedule === cron)?.name;
}
