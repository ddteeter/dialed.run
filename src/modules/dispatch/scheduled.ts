import { cronCheckpoints } from "../../db/schema-core";
import { coreDb, env } from "../../env";
import {
  checkAbandonedEnrichments,
  checkExtractionYield,
  listAbandonedEnrichments,
  redispatchStalledEnrichments,
} from "../enrichment";
import { forgetAnsweredRequests } from "../account/access";
import { checkTooLargeExports, sweepExports } from "../account/export-build";
import { rescreenHandlesFromEnv } from "../account/handles";
import { purgeDueAccounts } from "../account/purge";
import {
  sweepExpiredAuthRows,
  sweepExpiredCounts,
  sweepExpiredStates,
} from "../auth/expired-rows";
import { linkTypedGarments } from "../closet";
import { sweepRateLimits } from "../email";
import { sweepCopyrightHolds } from "../feed/moderation";
import { fillMissingTimeZones } from "../onboarding";
import { pruneStravaIds } from "../runs";
import { redispatchStalledImports } from "../runs/imports";
import { redispatchStrandedRevocations } from "../runs/strava";
import { retryPendingWeather, timeZoneAtFor } from "../weather";
import { checkWeatherBacklog } from "../weather/backlog";
import {
  backUpMedia,
  oweDigestEmail,
  oweRemovalReminders,
  type DigestMail,
} from "../ops/daily";
import { checkDeploymentConfig, cronNameFor, type CronName } from "../ops/desk";
import {
  checkOutboxBacklog,
  drainOutbox,
  oweInCore,
  type OutboxHandlers,
} from "../ops/outbox";
import { outboxHandlers, type ProductLinker } from "./outbox-handlers";
import {
  purgePublicPages,
  sweepPublicPhotos,
  workerPublicPhotos,
  type PublicPhotoDeps,
} from "../ops/public-web";
import type { SpeedFinding } from "../ops/speed";
import {
  captureException,
  sentryCronReporter,
  type CronReporter,
  type SentryReport,
} from "../ops/sentry";
import {
  classifierFromEnv,
  dayHeadroom,
  declineLapsedRequests,
  HEADROOM_WARN_SHARE,
  pendingReviewCount,
  quietScreenerWeek,
  purgeExpiredQuarantine,
  reconcileUnhiddenReports,
  releaseStaleClaims,
  retryPendingScreenings,
  sweepModerationRecords,
  TRIP_LOOKBACK_S,
  tripsSince,
  type CeilingReading,
  thresholdsAnomaly,
  moderationThresholds,
} from "../safety";

import { nowSeconds } from "../../lib/now";

/**
 * What a cron run found. `anomalies` are the things a human should look
 * at — the digest's whole product, and an hourly firing's findings — and
 * they are returned as well as shipped to Sentry so that "the firing found
 * nothing" is a fact a caller and a test can read.
 */
export interface ScheduledOutcome {
  readonly cronName: string;
  readonly anomalies: readonly string[];
}

/**
 * Cron entry (000 §10). Every cron writes its heartbeat row first, then
 * checks in with Sentry Crons around the work (OPS-3): `in_progress`, then
 * `ok` or `error`. The row says when a cron last ran to anyone reading the
 * database; the check-in says so to someone who is not, and is the only one
 * of the two that can notice a cron that stopped firing altogether. Nothing
 * reads the row for staleness, on purpose (design 162): a check inside the
 * daily firing would stop with it, and would report through the same
 * Sentry the check-ins already reach.
 *
 * `reporter` is a parameter so a test can read the check-ins and digest
 * events a firing produced. Production passes nothing and gets Sentry.
 * `upkeep` (`DailyUpkeep`) is spread over `liveUpkeep` (`Upkeep`):
 * production hands in only the two speed fields, which read the route tree
 * the Worker entry builds, and a test replaces any job. The jobs
 * `liveUpkeep` sets cannot be named `undefined`, so every firing runs them;
 * only the product link, the digest's mail and the speed checks can be
 * left out.
 */
export async function handleScheduled(
  controller: ScheduledController,
  reporter: CronReporter = sentryCronReporter,
  handedIn: DailyUpkeep = {},
): Promise<ScheduledOutcome> {
  const upkeep: Upkeep = { ...liveUpkeep, ...handedIn };
  const db = coreDb();
  const cronName = cronNameFor(controller.cron);
  await db
    .insert(cronCheckpoints)
    .values({ cronName: cronName ?? "unknown", lastRunAt: nowSeconds() })
    .onConflictDoUpdate({
      target: cronCheckpoints.cronName,
      set: { lastRunAt: nowSeconds() },
    });

  if (cronName === undefined) {
    // Config/code skew that the bindings-conformance test should have
    // caught in CI before it could reach a real schedule. No check-in: a
    // monitor named for a schedule nobody registered would be a second
    // thing to forget.
    captureException(new Error("unrecognized cron fired"), {
      cron: controller.cron,
    });
    return { cronName: "unknown", anomalies: [] };
  }

  const checkIn = reporter.checkIn({
    slug: cronName,
    schedule: controller.cron,
  });
  try {
    const anomalies = await runCron(cronName, reporter, upkeep);
    checkIn.finish("ok");
    return { cronName, anomalies };
  } catch (error) {
    checkIn.finish("error");
    throw error;
  }
}

/**
 * The firings' work that belongs to other modules, and the two speed
 * checks. Every field is a seam: `liveUpkeep` holds the real jobs, and
 * `handleScheduled` spreads what it is handed (`DailyUpkeep`, every field
 * optional) over it, so a test replaces one job. The six jobs `liveUpkeep`
 * sets are required here, so none can be handed in as `undefined`; the
 * product link, the digest's mail and the speed checks can, and a firing
 * without one goes on without it.
 *
 * **Account deletion's purge** (task 126, ACC-9, `account/purge`) reports
 * what it could not finish into the digest's `account-deletion` lines
 * (law 6).
 *
 * **The digest's email** (OPS-11) is ops' own; it is a field so a test
 * can name the operators it goes to. Unset, it mails the live way
 * (`oweDigestEmail`'s default).
 *
 * **The data export's sweep** (task 126, ACC-10, `account/export-build`)
 * is the one hourly job here: it deletes expired ZIPs and re-sends
 * exports whose queue send was lost, and rides the `:00` firing so a lost
 * send costs a runner an hour, not a day.
 *
 * **The handle re-ask** (task 126 PR B, `account/handles`) rides the `:15`
 * firing beside photo screening, its sibling: handles claimed while
 * moderation could not answer are asked about again. It runs last, after
 * that firing's email drain, because its calls wait on moderation and the
 * mail should not.
 *
 * **The product link** (design 133, D-113 Q1, `closet`): the outbox rows a
 * confirmation owes are drained on the `:00` firing with it, so a newly
 * confirmed runner's garments link within the hour, and on the daily
 * firing's full drain. A product link drained with no linker stays owed
 * and is reported.
 *
 * **The auth rows' sweep** (`auth/expired-rows`): expired sessions and
 * spent password-try counts, deleted on the daily firing beside the send
 * limits' own sweep. **The answered access requests' sweep**
 * (`account/access`): requests invited or declined 90 days ago. **The
 * copyright holds' sweep** (D-130, `feed/moderation`): it restores what a
 * counter-notice saved on its 12th weekday and deletes what was held 30
 * days with none pending.
 *
 * **The speed digest** (design 165) and **the hourly speed checks** are
 * ops' own, and the two fields the Worker entry still hands in: each reads
 * the route names the tree could have written, and only the Worker entry
 * builds the router. They are fields too so a test fakes the Analytics
 * Engine SQL API rather than reach it. The digest is handed today's UTC
 * day, rolls up the days before it into the ops database and judges
 * yesterday (`speed-digest.ts`); the hourly checks ride the `:30` firing,
 * each finding its own event (`speedReport`).
 */
interface Upkeep {
  readonly purgeAccounts: (anomalies: string[]) => Promise<void>;
  readonly digestMail?: DigestMail | undefined;
  readonly sweepExports: (anomalies: string[]) => Promise<void>;
  readonly rescreenHandles: (anomalies: string[]) => Promise<void>;
  readonly linkProducts?: ProductLinker | undefined;
  readonly sweepAuthRows: () => Promise<void>;
  readonly forgetAnsweredRequests: () => Promise<void>;
  readonly sweepCopyrightHolds: () => Promise<void>;
  readonly speed?:
    ((today: string, anomalies: string[]) => Promise<void>) | undefined;
  readonly speedHourly?:
    | ((now: number, report: (finding: SpeedFinding) => void) => Promise<void>)
    | undefined;
}

/**
What a firing is handed: any of `Upkeep`'s jobs, each in place of the live
one.
*/
export type DailyUpkeep = Partial<Upkeep>;

/**
The jobs a firing runs when a test does not replace them.
*/
const liveUpkeep: Upkeep = {
  purgeAccounts: purgeDueAccounts,
  sweepExports,
  rescreenHandles: rescreenHandlesFromEnv,
  linkProducts: linkTypedGarments,
  sweepAuthRows: sweepExpiredAuthRows,
  forgetAnsweredRequests,
  sweepCopyrightHolds,
};

/**
The outbox's handlers, with the product link bound to the one handed in.
*/
function handlersFor(upkeep: Upkeep): OutboxHandlers {
  return outboxHandlers(upkeep.linkProducts);
}

/**
 * The product links confirmations owe (D-113 Q1), every hour: no fast
 * path works them, so this is how soon a confirmed runner's garments link.
 */
async function drainProductLinks(
  anomalies: string[],
  upkeep: Upkeep,
): Promise<void> {
  await drainOutbox(coreDb(), anomalies, {
    kinds: ["product_link"],
    handlers: handlersFor(upkeep),
    lines: "unsettled",
  });
}

async function runCron(
  cronName: CronName,
  reporter: CronReporter,
  upkeep: Upkeep,
): Promise<readonly string[]> {
  switch (cronName) {
    case "daily-digest": {
      return runDailyDigest(reporter, upkeep);
    }
    case "weather-retry": {
      return runHourly(cronName, reporter, (anomalies) => [
        // First the steps whose work is bounded and on a clock. C6's
        // 40-hour reminder: hourly, so it lands before the deadline the
        // daily digest could miss (`removal-reminders.ts`).
        () => oweRemovalReminders(coreDb()),
        // A removal request still waiting on its confirm past its 48
        // hours is declined (`takedown-requests.ts`).
        () => declineLapsedRequests(coreDb()),
        // Better Auth's expired sign-in states and reset links, every
        // hour (owner, 2026-11-21), a bounded number of batches.
        () => sweepExpiredStates(),
        // Rate-limit counts past their window, ours and Better Auth's:
        // every hour, a bounded number of batches each.
        () => sweepRateLimits(coreDb()),
        () => sweepExpiredCounts(),
        // Then the steps whose work grows with what runners have queued:
        // the export sweep, owed email, the product links, and the
        // pending-observation retry (docs/tasks/103-weather.md
        // requirement 4/5, claim-then-work at the module level).
        () => upkeep.sweepExports(anomalies),
        () => drainOwedEmail(anomalies),
        () => drainProductLinks(anomalies, upkeep),
        () => retryPendingWeather(captureException),
        // Profiles whose zone lookup failed when the place was saved
        // (design 142): a NULL zone beside coordinates is the marker.
        // Last, because its lookups can wait on Visual Crossing.
        () =>
          fillMissingTimeZones(coreDb(), {
            zoneAtFor: timeZoneAtFor,
            report: captureException,
          }),
      ]);
    }
    case "enrichment-retry": {
      return runHourly(cronName, reporter, (anomalies) => [
        () =>
          redispatchStalledEnrichments(
            anomalies,
            env.ENRICHMENT_QUEUE,
            captureException,
          ),
        // What the sweep just stopped re-driving goes on the Desk's Gave
        // up (R-119): the hour a product's day runs out, not the morning
        // after.
        () => listAbandonedEnrichments(coreDb()),
        () => drainOwedEmail(anomalies),
        () => reportHourlySpeed(upkeep.speedHourly, reporter),
      ]);
    }
    case "screening-retry": {
      return runHourly(cronName, reporter, (anomalies) => [
        // Three reconciliations, each its own step, so one that throws
        // costs neither of the others.
        () => runScreeningRetry(anomalies),
        () => reconcileReportHides(anomalies),
        () => releaseAbandonedClaims(anomalies),
        // After the screening retry, so a photo it just passed on a
        // PUBLIC kit is copied this hour (design 163 step 8).
        () => sweepPublicPhotoCopies(anomalies),
        // Email before the re-ask: each handle may wait its full five
        // seconds on moderation, and owed mail should not wait behind it.
        () => drainOwedEmail(anomalies),
        () => upkeep.rescreenHandles(anomalies),
        () => reportBreakerTrips(reporter),
      ]);
    }
  }
}

type Step = () => Promise<unknown> | undefined;

type HourlyCron = Exclude<CronName, "daily-digest">;

/**
 * An hourly firing (design 162): its steps, then what they found, sent to
 * Sentry as one event. Sent when a step threw as well, because what the
 * other steps found is still true, and a firing that throws is when it
 * matters most.
 */
async function runHourly(
  cronName: HourlyCron,
  reporter: CronReporter,
  steps: (anomalies: string[]) => readonly Step[],
): Promise<readonly string[]> {
  const anomalies: string[] = [];
  try {
    await eachStep(steps(anomalies));
  } finally {
    if (anomalies.length > 0) {
      reporter.report(
        new Error(`hourly: ${cronName}`),
        hourlyReport(cronName, anomalies, utcDay()),
      );
    }
  }
  return anomalies;
}

/**
 * The event for one hourly cron's findings on one day. These findings
 * once went nowhere: the Worker entry drops the outcome, and only the
 * digest reported.
 *
 * Fingerprinted by cron and day, so the first finding of a day opens a
 * new issue and Sentry's default new-issue alert fires once, not 24
 * times. The tag is `digest: hourly`, never `daily`, so the every-event
 * rule on the daily digest (deployment §8) does not page on each hour.
 */
export function hourlyReport(
  cronName: HourlyCron,
  lines: readonly string[],
  day: string,
): SentryReport {
  return anomalyReport(
    { cron: cronName },
    { digest: "hourly", cron: cronName },
    ["hourly", cronName, day],
    lines,
  );
}

/**
 * How many of one check's findings a firing sends as their own events
 * (SA-M34). A route name in the speed data is whatever a beacon said, so
 * past this the rest are one event with their count: a firing's sends are
 * bounded, and a real regression among the first few is still its own
 * issue. Five is the owner's number (2026-11-16).
 */
export const SPEED_EVENTS_PER_CHECK = 5;

/**
 * Runs the hourly speed checks and sends what they found, capped per
 * check (`speedReports`). Sent in a `finally`, so the findings of a check
 * that succeeded still go out when the other throws.
 */
async function reportHourlySpeed(
  speedHourly: Upkeep["speedHourly"],
  reporter: CronReporter,
): Promise<void> {
  const findings: SpeedFinding[] = [];
  try {
    await speedHourly?.(nowSeconds(), (finding) => {
      findings.push(finding);
    });
  } finally {
    for (const [check, report] of speedReports(findings, utcDay())) {
      reporter.report(new Error(`speed: ${check}`), report);
    }
  }
}

/**
 * A firing's speed findings as events: each check's first
 * `SPEED_EVENTS_PER_CHECK` as their own (`speedReport`), and any more as
 * one event that counts them and quotes the first few, fingerprinted by
 * check and day.
 */
export function speedReports(
  findings: readonly SpeedFinding[],
  day: string,
): [string, SentryReport][] {
  const checks = [...new Set(findings.map((finding) => finding.check))];
  return checks.flatMap((check): [string, SentryReport][] => {
    const own = findings.filter((finding) => finding.check === check);
    const sent = own.slice(0, SPEED_EVENTS_PER_CHECK);
    const rest = own.slice(SPEED_EVENTS_PER_CHECK);
    const reports: [string, SentryReport][] = sent.map((finding) => [
      check,
      speedReport(finding, day),
    ]);
    if (rest.length > 0) {
      reports.push([
        check,
        anomalyReport(
          { check, more: String(rest.length) },
          { digest: "hourly", cron: "enrichment-retry", speed_check: check },
          ["perf", check, "more", day],
          [
            `${String(rest.length)} more findings than the ${String(SPEED_EVENTS_PER_CHECK)} sent`,
            ...rest
              .slice(0, SPEED_EVENTS_PER_CHECK)
              .map((finding) => finding.line),
          ],
        ),
      ]);
    }
    return reports;
  });
}

/**
 * The event for one hourly speed finding (design 165). Fingerprinted by
 * check, route, metric and day, so each regression is its own issue and
 * alerts once a day however many hours it lasts. Tagged `digest: hourly`
 * like the cron's own findings, so the daily digest's every-event rule
 * does not page on it.
 */
export function speedReport(finding: SpeedFinding, day: string): SentryReport {
  return anomalyReport(
    { check: finding.check, route: finding.route, metric: finding.metric },
    { digest: "hourly", cron: "enrichment-retry", speed_check: finding.check },
    ["perf", finding.check, finding.route, finding.metric, day],
    [finding.line],
  );
}

/**
 * The shape every report shares: the findings joined into one context
 * field beside whatever names the source, the tags an alert rule matches,
 * and the fingerprint Sentry groups by.
 */
function anomalyReport(
  source: Record<string, string>,
  tags: Record<string, string>,
  fingerprint: readonly string[],
  lines: readonly string[],
): SentryReport {
  return {
    context: { ...source, anomalies: lines.join("; ") },
    tags,
    fingerprint,
  };
}

/**
The UTC date a person reads a report under: one issue a day.
*/
function utcDay(): string {
  return new Date(nowSeconds() * 1000).toISOString().slice(0, 10);
}

/**
 * One event per hold breaker at its ceiling (design 164), each its own
 * issue a day: fingerprinted by cause and day, not folded into the
 * firing's own event, whose issue may already be open today and so would
 * alert nobody.
 *
 * Read over the last two hours, not on the hour (R-172): a burst split
 * across two firings stays under the ceiling in each hour taken alone, but
 * not in the sliding hour the breaker read while holding it.
 */
async function reportBreakerTrips(reporter: CronReporter): Promise<void> {
  const now = nowSeconds();
  const over = await tripsSince(coreDb(), now - TRIP_LOOKBACK_S, now);
  const day = utcDay();
  for (const reading of over) {
    reporter.report(
      new Error(`breaker: ${reading.cause}`),
      breakerReport(reading, day),
    );
  }
}

/**
The event for one breaker at its ceiling, on one day.
*/
export function breakerReport(
  reading: CeilingReading,
  day: string,
): SentryReport {
  const { cause, count, ceiling } = reading;
  return anomalyReport(
    { breaker: cause },
    { breaker: cause },
    ["breaker", cause, day],
    [
      `${cause} holds reached ${String(count)} of ${String(ceiling)} within an hour; past the ceiling they stop`,
    ],
  );
}

/**
 * An hourly firing's steps, each run whichever of the others fail (law
 * 5): a sweep that throws must not cost that hour's email drain, nor a
 * weather retry the sweep. The firing still throws once every step has
 * run — the one failure itself, or all of them together — so its check-in
 * closes as an error and the Worker entry reports what went wrong.
 */
async function eachStep(steps: readonly Step[]): Promise<void> {
  throwAny(await failuresOf(steps));
}

/**
Every step run, whichever fail; what they threw, in order.
*/
async function failuresOf(steps: readonly Step[]): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function throwAny(failures: readonly unknown[]): void {
  if (failures.length === 0) return;
  throw failures.length === 1
    ? failures[0]
    : new AggregateError(failures, "several upkeep steps failed");
}

/**
 * Owed email rides every hourly firing (task 126, ACC-2), not only the
 * daily digest's drain: a reminder held back 20 minutes (task 127) should
 * go out within the quarter hour it falls due, not the next noon, and a
 * notice whose fast path failed should be retried within the hour. Three
 * firings a quarter apart put a due row at most 30 minutes from its send.
 *
 * Each firing claims before it works (`drainOutbox`), so two overlapping
 * firings never send one row twice.
 */
async function drainOwedEmail(anomalies: string[]): Promise<void> {
  // The operators' mail first, on its own cap (design 232), and a line
  // for whatever either kind leaves due.
  await drainOutbox(coreDb(), anomalies, {
    kinds: ["operator_email", "email"],
    // No linker: this drain takes no `product_link` row.
    handlers: outboxHandlers(undefined),
    lines: "unsettled",
    backlog: true,
  });
}

/**
 * The public photo bucket's reconcile (D-153, design 163 step 8): copies
 * the publications no purge saw (a review's Approve, an unban, a photo
 * screened late), and deletes what a retraction's fast path missed. A
 * delete found here is a copy that stayed public longer than it should
 * have, so the digest names the count.
 */
export async function sweepPublicPhotoCopies(
  anomalies: string[],
  deps: PublicPhotoDeps = workerPublicPhotos(),
): Promise<void> {
  const found = await sweepPublicPhotos(deps);
  if (found.stale > 0) {
    anomalies.push(
      `${String(found.stale)} public photo copies were still up after their kit or photo stopped being public`,
    );
  }
  if (found.unnamed > 0) {
    anomalies.push(
      `${String(found.unnamed)} public photo objects had no row naming them and were deleted`,
    );
  }
}

async function runScreeningRetry(anomalies: string[]): Promise<void> {
  // Moderation fails closed without its config (`safety/screening/thresholds`), and
  // says so here every hour until the secret is right.
  const unconfigured = thresholdsAnomaly(moderationThresholds());
  if (unconfigured !== undefined) anomalies.push(unconfigured);
  // Task 106 §1: re-drive photos still marked `pending` (law 8c).
  // `pending` is the durable marker, so this is reconciliation and the
  // path needs no queue.
  await retryPendingScreenings(classifierFromEnv(), anomalies);
}

/**
 * Two more reconciliations share this firing, both raised on PR #73 and
 * both the same shape as the screening retry: a durable marker exists, so
 * something has to re-read it.
 *
 * The hide that `fileReport` does in a third statement, if the worker
 * died before reaching it — the reports are written, the entry is still
 * visible, and nothing else would ever notice.
 */
async function reconcileReportHides(anomalies: string[]): Promise<void> {
  const reconciled = await reconcileUnhiddenReports(
    oweInCore,
    purgePublicPages,
  );
  if (reconciled.hidden > 0) {
    anomalies.push(
      `${String(reconciled.hidden)} reported subjects were over the threshold and had not been hidden`,
    );
  }
}

/**
 * Review claims whose reviewer never came back, which otherwise hold a
 * subject out of the queue permanently.
 */
async function releaseAbandonedClaims(anomalies: string[]): Promise<void> {
  const released = await releaseStaleClaims();
  if (released.released > 0) {
    anomalies.push(
      `${String(released.released)} review claims went stale and were returned to the queue`,
    );
  }
}

/**
 * How much is waiting on a person (task 106 §2).
 *
 * Reported at ANY depth rather than past a threshold, and that is the
 * difference between this and the other digest checks. The others watch
 * for a system misbehaving, where a small number is noise; this one is a
 * queue whose whole promise is "a person reads it within a day", and the
 * failure mode is a queue nobody opened rather than a queue that grew.
 * One waiting report is worth saying out loud; zero says nothing, so the
 * digest stays quiet on the ordinary day.
 *
 * The number is safety's `pendingReviewCount`, which the Desk's Today
 * reads too, so the digest and Today cannot disagree (Operator Screens
 * D5) — and the digest does not pay for Today's other reads to get it.
 */
async function checkReviewQueueDepth(anomalies: string[]): Promise<void> {
  const waiting = await pendingReviewCount();
  if (waiting === 0) return;
  anomalies.push(`${String(waiting)} item(s) awaiting moderation review`);
}

/**
 * Each hold breaker whose busiest hour of the last day came within
 * `HEADROOM_WARN_SHARE` of its ceiling (design 164). The ceilings are
 * fixed numbers or rules set at pre-launch scale; this is what says one
 * needs revisiting before growth starts tripping it.
 */
async function checkBreakerHeadroom(anomalies: string[]): Promise<void> {
  const headroom = await dayHeadroom(coreDb(), nowSeconds());
  for (const { cause, used } of headroom) {
    if (used < HEADROOM_WARN_SHARE) continue;
    anomalies.push(
      `${cause} breaker's busiest hour in the last day reached ${String(Math.round(used * 100))}% of its ceiling`,
    );
  }
}

/**
 * A week of screenings with no flag and no review (design 164): the
 * classifier's model changing in the direction its breaker cannot see.
 */
async function checkQuietScreener(anomalies: string[]): Promise<void> {
  const screened = await quietScreenerWeek(coreDb(), nowSeconds());
  if (screened === undefined) return;
  anomalies.push(
    `The classifier flagged or queued none of ${String(screened)} photos screened this week; check its model has not changed`,
  );
}

/**
 * What the digest checks, one kind per line of the report.
 *
 * **The kind is what Sentry groups by** (OPS-2, audit finding 0.5). Every
 * digest used to be one `Error("daily digest anomalies")`, so every day
 * folded into the first day's issue, and Sentry's default alert — new
 * issues only — never fired again. Each kind now sends its own event,
 * fingerprinted by kind *and day*, so a new day is a new issue, and tagged
 * so an alert rule can match every digest event by tag whatever it groups
 * into. The rule itself is a deployment step (deployment plan §5).
 */
export const digestKinds = [
  "weather-backlog",
  "extraction-yield",
  "abandoned-enrichment",
  "strava-revocation",
  "outbox",
  "stalled-import",
  "review-queue",
  "breaker-headroom",
  "screener-quiet",
  "export-too-large",
  "account-deletion",
  "speed",
  "media-backup",
  "config",
] as const;

export type DigestKind = (typeof digestKinds)[number];

/**
The check the daily firing runs after everything else.
*/
const PURGED_LAST: DigestKind = "account-deletion";

/**
 * The event for one kind on one day. The day is the digest's UTC date,
 * which is the unit a person reads it in: one issue per kind per morning.
 */
export function digestReport(
  kind: DigestKind,
  lines: readonly string[],
  day: string,
): SentryReport {
  return anomalyReport(
    { kind },
    { digest: "daily", digest_kind: kind },
    ["daily-digest", kind, day],
    lines,
  );
}

/**
 * Exception-based alerting: checks run, thresholds compare, and ONLY
 * anomalies get surfaced — one Sentry event per kind that found any.
 */
async function runDailyDigest(
  reporter: CronReporter,
  upkeep: Upkeep,
): Promise<string[]> {
  const db = coreDb();
  // The generic outbox rides the same firing as the Strava one: drain
  // first, so the backlog check counts only what is still owed.
  // Keyed by kind and walked in `digestKinds` order, so the table cannot
  // name a kind the list does not, nor leave one out: the compiler holds
  // the keys to the union, and a missing entry is a call to `undefined`.
  const checks: Readonly<
    Record<DigestKind, (anomalies: string[]) => Promise<void>>
  > = {
    "weather-backlog": checkWeatherBacklog,
    "extraction-yield": checkExtractionYield,
    "abandoned-enrichment": checkAbandonedEnrichments,
    "strava-revocation": (anomalies) =>
      redispatchStrandedRevocations(
        anomalies,
        env.IMPORTS_QUEUE,
        captureException,
      ),
    outbox: async (anomalies) => {
      // One `now` for both, so a row the drain backed off is not still due.
      const now = nowSeconds();
      await drainOutbox(db, anomalies, { handlers: handlersFor(upkeep), now });
      await checkOutboxBacklog(db, anomalies, now);
    },
    "stalled-import": (anomalies) =>
      redispatchStalledImports(anomalies, env.IMPORTS_QUEUE, captureException),
    "review-queue": checkReviewQueueDepth,
    "breaker-headroom": checkBreakerHeadroom,
    "screener-quiet": checkQuietScreener,
    "export-too-large": (anomalies) => checkTooLargeExports(anomalies),
    "account-deletion": async (anomalies) => {
      await upkeep.purgeAccounts(anomalies);
    },
    speed: async (anomalies) => {
      await upkeep.speed?.(utcDay(), anomalies);
    },
    // The photo backup (D-172, design 186): daily. A photo the purge
    // deletes is set aside by the next day's backup.
    "media-backup": async (anomalies) => {
      await backUpMedia(
        { source: env.MEDIA, backup: env.MEDIA_BACKUP },
        anomalies,
        { now: nowSeconds() },
      );
    },
    // Each deployment value the plan needs that is not set (design 237):
    // a missed deploy step is named every morning until it is done.
    config: (anomalies) => {
      checkDeploymentConfig(anomalies);
      return Promise.resolve();
    },
  };
  // Threshold checks fill in as their features land:
  // - failed-import rate (lane 102)
  const day = utcDay();
  const everything: string[] = [];
  // Each check runs whichever of the others throw (design 162): a weather
  // read that fails must not cost the day's outbox drain. What a throwing
  // check found before it threw is still reported, and the firing throws
  // at the end, so its check-in closes as an error.
  const runCheck = (kind: DigestKind) => async () => {
    const lines: string[] = [];
    try {
      await checks[kind](lines);
    } finally {
      if (lines.length > 0) {
        reporter.report(
          new Error(`daily digest: ${kind}`),
          digestReport(kind, lines, day),
        );
        everything.push(...lines);
      }
    }
  };
  const failed = await failuresOf(
    digestKinds
      .filter((kind) => kind !== PURGED_LAST)
      .map((kind) => runCheck(kind)),
  );
  // Upkeep that reports nothing to the digest, then the morning email.
  // Each runs whether the others throw, so none of them can cost the
  // sweeps or the purge; a throw is thrown at the end with the rest.
  const upkept = await failuresOf([
    // Strava's seven-day cache rule, on the activity ids we hold (task
    // 127, STR-10). Rides this firing rather than a cron of its own.
    () => pruneStravaIds(db),
    // The suspected-CSAM quarantine's year (task 128, D-70): silent to
    // everyone but Sentry, which hears of each record this firing claimed
    // and could not purge (law 6). Each one stays, due again tomorrow.
    async () => {
      const purge = await purgeExpiredQuarantine(db);
      for (const failure of purge.failed) {
        captureException(failure.error, {
          surface: "quarantine-purge",
          quarantineId: failure.id,
        });
      }
    },
    // D5: the morning email, every day, even when every number is zero
    // (task 125 · OPS-11, through task 126's email module).
    () => oweDigestEmail(db, upkeep.digestMail),
  ]);
  // Rows kept past any use: password-try counts whose window ended a day
  // ago, sessions expired a month ago, access requests answered 90 days ago, moderation
  // records whose 3 years are up (D-131). After the
  // email, so a sweep that throws costs only itself, and each runs whether
  // the others fail (law 5). A check that threw above is thrown with
  // them.
  const sweeps = await failuresOf([
    () => upkeep.sweepAuthRows(),
    () => upkeep.forgetAnsweredRequests(),
    () => upkeep.sweepCopyrightHolds(),
    // After the holds' own sweep, so a hold it settles today is not
    // judged on yesterday's status.
    () => sweepModerationRecords(db),
  ]);
  // The account purge last, after every other check, the email and the
  // sweeps, with its lines reported as its own kind.
  const purged = await failuresOf([runCheck(PURGED_LAST)]);
  throwAny([...failed, ...upkept, ...sweeps, ...purged]);
  return everything;
}
