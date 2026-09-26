import { Toucan } from "toucan-js";

import { env, waitUntil } from "../../env";

/**
 * Keeps the invocation alive until a promise settles.
 *
 * **Why every Toucan gets one** (audit finding 0.4). Toucan sends its event
 * with a plain `fetch`, and it only hands that fetch to `waitUntil` when a
 * `context` is passed in (`toucan-js` dist, the `makeFetchTransport`
 * branch). Without it, every caller here either rethrows or returns
 * straight after reporting, the invocation ends, and the runtime is free to
 * cancel the send — so an error could be "reported" and never arrive.
 *
 * `waitUntil` is the `cloudflare:workers` export rather than a threaded
 * `ctx`, because reports come from deep inside queue consumers and cron
 * checks where no `ctx` is in reach, and a missed thread would fail
 * silently in exactly the way this fixes. It is a *required* parameter
 * below so the compiler, not a reviewer, holds every caller to it.
 */
export type KeepAlive = (promise: Promise<unknown>) => void;

/**
 * What an event carries besides the error. `tags` is required and
 * `fingerprint` is not: a tag set may be empty, but an empty fingerprint
 * would be a claim about grouping that nobody made.
 */
export interface SentryReport {
  readonly context: Record<string, string>;
  readonly tags: Record<string, string>;
  /**
  Sentry groups events into issues by this when it is set.
  */
  readonly fingerprint?: readonly string[];
}

/**
 * A Toucan for this DSN, or `undefined` when there is none.
 *
 * An unset secret arrives as an empty string as often as it does
 * undefined, and an empty DSN makes Toucan throw on construction — which
 * would turn a missing reporter into a crash in the error path.
 */
function toucanFor(
  dsn: string | undefined,
  keepAlive: KeepAlive,
): Toucan | undefined {
  if (dsn === undefined || dsn === "") return undefined;
  return new Toucan({ dsn, context: { waitUntil: keepAlive } });
}

/**
 * The reporting decision, with the DSN and the keep-alive handed in rather
 * than read.
 *
 * Split out because both halves matter and only one is reachable through
 * `captureException`: `SENTRY_DSN` comes from the Worker's bindings, which
 * a test cannot change from inside the isolate, so the Toucan path could
 * never be exercised through the env-reading shell. With both as
 * parameters, "an unset DSN must never fail the app", "a set DSN actually
 * sends" and "the send outlives the invocation" are all testable.
 */
export function reportException(
  dsn: string | undefined,
  keepAlive: KeepAlive,
  error: unknown,
  report: SentryReport,
): void {
  const sentry = toucanFor(dsn, keepAlive);
  if (sentry === undefined) {
    console.error("[sentry-disabled]", report.context, error);
    return;
  }
  sentry.setContext("dialed", report.context);
  sentry.setTags(report.tags);
  if (report.fingerprint !== undefined) {
    sentry.setFingerprint([...report.fingerprint]);
  }
  sentry.captureException(error);
}

/**
 * Error reporting (CLAUDE.md law 7): context enough to act on, never
 * tokens, file contents, or request bodies. No-op locally when
 * SENTRY_DSN is unset — a missing reporter must never fail the app.
 */
export function captureException(
  error: unknown,
  context: Record<string, string>,
): void {
  reportException(env.SENTRY_DSN, waitUntil, error, { context, tags: {} });
}

/**
A cron as Sentry Crons sees it: a slug and the schedule it should keep.
*/
export interface CronMonitor {
  readonly slug: string;
  readonly schedule: string;
}

/**
 * An open firing: the `in_progress` check-in has been sent, and `finish`
 * sends the `ok` or `error` that closes it. Sentry Crons raises an issue
 * when a firing misses its window or never finishes — the dead-man switch
 * the digest cannot be for itself, because a digest that never runs
 * reports nothing (audit §3.5).
 */
export interface CheckIn {
  finish(status: "ok" | "error"): void;
}

/**
 * Minutes Sentry waits past the schedule before calling a firing missed,
 * and the longest a firing may run before it is called failed. Every cron
 * here finishes in seconds; the margins are about Cloudflare's own
 * scheduling jitter, not our runtime.
 */
const CHECKIN_MARGIN_MINUTES = 5;
const MAX_RUNTIME_MINUTES = 10;

/**
 * What a firing gets when there is no DSN to check in with.
 */
const NO_CHECK_IN: CheckIn = {
  finish() {
    /*
     * Nothing was opened, so there is nothing to close.
     */
  },
};

/**
 * Opens a firing with Sentry Crons, or does nothing when there is no DSN.
 *
 * The `monitorConfig` rides on the opening check-in, which is Sentry's
 * upsert: the monitor creates itself on its first firing and follows the
 * schedule if `crons.ts` changes it, so there is no dashboard step to
 * forget. Wrangler's crons are UTC.
 *
 * Opening is the call rather than a `start()` on the result, so a close
 * can only ever carry the id of a check-in that was actually opened.
 */
export function openCheckIn(
  dsn: string | undefined,
  keepAlive: KeepAlive,
  monitor: CronMonitor,
): CheckIn {
  const sentry = toucanFor(dsn, keepAlive);
  if (sentry === undefined) return NO_CHECK_IN;
  const checkInId = sentry.captureCheckIn(
    { monitorSlug: monitor.slug, status: "in_progress" },
    {
      schedule: { type: "crontab", value: monitor.schedule },
      checkinMargin: CHECKIN_MARGIN_MINUTES,
      maxRuntime: MAX_RUNTIME_MINUTES,
      timezone: "Etc/UTC",
    },
  );
  return {
    finish(status) {
      sentry.captureCheckIn({ monitorSlug: monitor.slug, status, checkInId });
    },
  };
}

/**
 * The reporting a cron needs, as one seam: the check-ins and the digest's
 * events. `handleScheduled` takes it as a parameter so a test can read
 * what a firing reported — the real one only logs in tests, because the
 * test bindings carry no DSN.
 */
export interface CronReporter {
  readonly checkIn: (monitor: CronMonitor) => CheckIn;
  readonly report: (error: unknown, report: SentryReport) => void;
}

export const sentryCronReporter: CronReporter = {
  checkIn: (monitor) => openCheckIn(env.SENTRY_DSN, waitUntil, monitor),
  report: (error, report) => {
    reportException(env.SENTRY_DSN, waitUntil, error, report);
  },
};
