import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import {
  notifications,
  outbox,
  runs,
  stravaConnections,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { calendarDay, clockLabel } from "../../src/lib/dates";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { setEmailPreference } from "../../src/modules/email";
import {
  drainOutbox,
  outboxInsert,
  oweOutbox,
} from "../../src/modules/ops/outbox";
import {
  emailHandler,
  outboxHandlers,
} from "../../src/modules/ops/outbox-handlers";
import { handleImportsBatch } from "../../src/modules/runs/consumer";
import type { ConsumerDeps } from "../../src/modules/runs/consumer";
import { coreDb } from "../../src/modules/runs/core-db";
import { emailDebt } from "../../src/modules/email";
import { cacheKeyFor } from "../../src/modules/weather";
import {
  REMINDER_EMAIL_DELAY_S,
  owedReminderEmail,
  runnerZone,
  type EarlierReminder,
} from "../../src/modules/runs/strava/reminder-email";
import { pairWithReminder } from "../../src/modules/runs/strava/reminder-match";
import { fakeMail, seedUser } from "../email/helpers";
import { batchOf, fakeMessage, oweInCore } from "../queue-fakes";

/**
 * STR-9 (design 140): a run landing on Strava owes one reminder email, 20
 * minutes on, at most one a day, skipped once its bell row is read. The
 * failure mode is emailing a runner over and over, so each way it could
 * repeat is pinned.
 */

const HOUR = 60 * 60;
const CHICAGO = "America/Chicago";
// 2026-10-12 14:00 UTC is 9:00 AM in Chicago (CDT, UTC−5).
const LANDED = Math.floor(Date.UTC(2026, 9, 12, 14) / 1000);

function landing(
  overrides: Partial<Parameters<typeof owedReminderEmail>[1]> = {},
) {
  return {
    userId: "u1",
    notificationId: "n1",
    at: LANDED,
    zone: CHICAGO,
    ...overrides,
  };
}

function reminder(
  createdAt: number,
  overrides: Partial<EarlierReminder> = {},
): EarlierReminder {
  return { createdAt, read: false, ...overrides };
}

function runsCounted(earlier: readonly EarlierReminder[]): number | undefined {
  const owed = owedReminderEmail(earlier, landing());
  if (owed?.message.kind !== "email") return undefined;
  const { template } = owed.message.payload.email;
  return template.kind === "run_reminder" ? template.runs : undefined;
}

describe("owedReminderEmail: whether a landing owes the email", () => {
  it("owes the day's first: held 20 minutes, keyed by the runner's day, repeating its bell row", () => {
    expect(owedReminderEmail([], landing())).toStrictEqual({
      message: {
        kind: "email",
        payload: {
          dedupeKey: "run_reminder:u1:12 Oct 2026",
          email: {
            to: { userId: "u1" },
            template: { kind: "run_reminder", landedAt: "9:00 AM", runs: 1 },
          },
          unlessRead: "n1",
        },
      },
      notBefore: LANDED + 20 * 60,
    });
    expect(REMINDER_EMAIL_DELAY_S).toBe(1200);
  });

  it("writes the clock in UTC when the runner's zone is unknown", () => {
    const owed = owedReminderEmail([], landing({ zone: undefined }));
    expect(owed?.message).toMatchObject({
      payload: { email: { template: { landedAt: "2:00 PM" } } },
    });
  });

  it("owes nothing when the runner already had a reminder today, read or not", () => {
    expect(
      owedReminderEmail([reminder(LANDED - 3 * HOUR)], landing()),
    ).toBeUndefined();
    expect(
      owedReminderEmail(
        [reminder(LANDED - 3 * HOUR, { read: true })],
        landing(),
      ),
    ).toBeUndefined();
  });

  it("reckons the day in the runner's zone, not UTC's", () => {
    // 03:00 UTC on the 12th is 10 PM on the 11th in Chicago.
    const lastNight = [reminder(LANDED - 11 * HOUR)];
    expect(owedReminderEmail(lastNight, landing())).toBeDefined();
    expect(
      owedReminderEmail(lastNight, landing({ zone: undefined })),
    ).toBeUndefined();
  });

  it("counts yesterday's later reminders still unread, never yesterday's first", () => {
    const yesterday = LANDED - 24 * HOUR;
    expect(runsCounted([reminder(yesterday)])).toBe(1);
    expect(runsCounted([reminder(yesterday), reminder(yesterday + HOUR)])).toBe(
      2,
    );
    expect(
      runsCounted([
        reminder(yesterday, { read: true }),
        reminder(yesterday + HOUR),
        reminder(yesterday + 2 * HOUR, { read: true }),
        reminder(yesterday + 3 * HOUR),
      ]),
    ).toBe(3);
  });

  it("does not count a reminder from two days back", () => {
    const twoDaysBack = LANDED - 48 * HOUR;
    expect(
      runsCounted([reminder(twoDaysBack), reminder(twoDaysBack + HOUR)]),
    ).toBe(1);
  });
});

function core() {
  return coreDb();
}

async function connectedRunner(
  options: Readonly<{ isVerified?: boolean }> = {},
): Promise<{ userId: string; athleteId: string; email: string }> {
  const { userId, email } = await seedUser(options);
  const athleteId = newUlid();
  await core()
    .insert(stravaConnections)
    .values({ userId, athleteId, refreshToken: "refresh" });
  return { userId, athleteId, email };
}

function reminderJob(athleteId: string, objectId = newUlid()) {
  return {
    type: "strava_reminder",
    athleteId,
    objectId,
    aspectType: "create",
    eventTime: nowSeconds(),
  };
}

function deps(overrides: Partial<ConsumerDeps> = {}): ConsumerDeps {
  return {
    db: core(),
    importBucket: env.IMPORTS,
    captureException: vi.fn(),
    owe: oweInCore,
    ...overrides,
  };
}

async function deliver(body: unknown, consumer = deps()): Promise<void> {
  const message = fakeMessage(newUlid(), body);
  await handleImportsBatch(batchOf("dialed-imports", [message]), consumer);
}

async function owedFor(userId: string) {
  const rows = await core()
    .select()
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows.filter((row) =>
    row.dedupeKey.startsWith(`run_reminder:${userId}:`),
  );
}

async function reminderRows(userId: string) {
  return core()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

describe("the consumer owes it in the bell row's batch", () => {
  it("owes one email, 20 minutes after the run landed, naming the bell row", async () => {
    const { userId, athleteId } = await connectedRunner();
    const before = nowSeconds();
    await deliver(reminderJob(athleteId));
    const after = nowSeconds();

    const [row, ...rest] = await owedFor(userId);
    expect(rest).toStrictEqual([]);
    expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(before + 1200);
    expect(row?.nextAttemptAt).toBeLessThanOrEqual(after + 1200);
    const landed = (row?.nextAttemptAt ?? 0) - 1200;
    const [bell] = await reminderRows(userId);
    const read = readOutboxRow(row?.kind ?? "", row?.payload ?? "");
    expect(read).toStrictEqual({
      ok: true,
      message: {
        kind: "email",
        payload: {
          dedupeKey: `run_reminder:${userId}:${calendarDay(landed)}`,
          email: {
            to: { userId },
            template: {
              kind: "run_reminder",
              landedAt: clockLabel(landed),
              runs: 1,
            },
          },
          unlessRead: bell?.id,
        },
      },
    });
    // D-33: no Strava id rides the outbox.
    expect(row?.payload).not.toContain(athleteId);
  });

  it("reckons in UTC, quietly, when no zone lookup is wired", async () => {
    const { athleteId } = await connectedRunner();
    const consumer = deps();
    await deliver(reminderJob(athleteId), consumer);
    expect(consumer.captureException).not.toHaveBeenCalled();
  });

  it("reads yesterday's reminders from the bell rows: the next day counts both", async () => {
    const { userId, athleteId } = await connectedRunner();
    const yesterday = nowSeconds() - 24 * HOUR;
    // Yesterday's first owed yesterday's email; its second did not.
    await core()
      .insert(notifications)
      .values(
        [yesterday, yesterday + 1].map((createdAt) => ({
          id: newUlid(),
          userId,
          kind: "strava_reminder",
          subjectId: newUlid(),
          body: "New run on Strava",
          read: false,
          createdAt,
        })),
      );
    await deliver(reminderJob(athleteId));

    const [row] = await owedFor(userId);
    expect(row?.payload).toContain('"runs":2');
  });

  it("owes no second email for a second run the same day", async () => {
    const { userId, athleteId } = await connectedRunner();
    await deliver(reminderJob(athleteId));
    const [first] = await owedFor(userId);
    await deliver(reminderJob(athleteId));

    expect(await reminderRows(userId)).toHaveLength(2);
    expect(await owedFor(userId)).toStrictEqual([first]);
  });

  it("owes once for a redelivered message, before the send and after it", async () => {
    const { userId, athleteId } = await connectedRunner();
    const job = reminderJob(athleteId);
    await deliver(job);
    const [first] = await owedFor(userId);
    await deliver(job);
    expect(await owedFor(userId)).toStrictEqual([first]);

    // Sent: the drain deletes the row. A redelivery now must not owe again.
    await core()
      .delete(outbox)
      .where(eq(outbox.id, first?.id ?? ""));
    await deliver(job);
    expect(await owedFor(userId)).toStrictEqual([]);
    expect(await reminderRows(userId)).toHaveLength(1);
  });

  it("owes nothing for an event redelivered after it paired an upload", async () => {
    // Delivery 1 pairs the run already uploaded and loses its ack. The run
    // is now paired, so a redelivery that re-asked "is there an unpaired
    // upload?" would hear no, and write a stale reminder with an email.
    const { userId, athleteId } = await connectedRunner();
    const runId = newUlid();
    await core()
      .insert(runs)
      .values({
        id: runId,
        userId,
        source: "file",
        startedAt: nowSeconds() - 2000,
        durationS: 1800,
        distanceM: 5000,
        title: "Already uploaded",
      });
    const job = reminderJob(athleteId);
    await deliver(job);
    const [paired] = await core()
      .select({ at: runs.reminderMatchedAt })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(paired?.at).toBe(job.eventTime);

    await deliver(job);
    expect(await reminderRows(userId)).toStrictEqual([]);
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("reckons the runner's day and clock in their zone", async () => {
    const { userId, athleteId } = await connectedRunner();
    const zone = "Pacific/Kiritimati";
    await deliver(
      reminderJob(athleteId),
      deps({ runnerZone: () => Promise.resolve(zone) }),
    );

    const [row] = await owedFor(userId);
    const landed = (row?.nextAttemptAt ?? 0) - 1200;
    expect(row?.dedupeKey).toBe(
      `run_reminder:${userId}:${calendarDay(landed, zone)}`,
    );
    expect(row?.payload).toContain(`"landedAt":"${clockLabel(landed, zone)}"`);
  });

  it("still writes the bell row and the email, in UTC, when the zone cannot be had", async () => {
    const { userId, athleteId } = await connectedRunner();
    const failure = new Error("weather down");
    const consumer = deps({ runnerZone: () => Promise.reject(failure) });
    await deliver(reminderJob(athleteId), consumer);

    expect(consumer.captureException).toHaveBeenCalledWith(failure, {
      userId,
      surface: "runnerZone",
    });
    expect(await reminderRows(userId)).toHaveLength(1);
    const [row] = await owedFor(userId);
    const landed = (row?.nextAttemptAt ?? 0) - 1200;
    expect(row?.dedupeKey).toBe(
      `run_reminder:${userId}:${calendarDay(landed)}`,
    );
  });
});

/**
The hourly drain, past the hold, sending through a fake binding.
*/
async function drainLater(mail: ReturnType<typeof fakeMail>): Promise<void> {
  await drainOutbox(drizzle(env.DIALED_CORE), [], {
    kinds: ["email"],
    now: nowSeconds() + HOUR,
    handlers: { ...outboxHandlers, email: emailHandler(() => mail) },
    report: vi.fn(),
  });
}

function sentTo(mail: ReturnType<typeof fakeMail>, address: string) {
  return mail.sent.filter((message) => message.to === address);
}

describe("at send time", () => {
  it("sends the owed reminder to a confirmed runner who wants it", async () => {
    const { userId, athleteId, email } = await connectedRunner();
    await deliver(reminderJob(athleteId));
    const mail = fakeMail();
    await drainLater(mail);

    const [message, ...rest] = sentTo(mail, email);
    expect(rest).toStrictEqual([]);
    expect(message?.subject).toBe("New run on Strava. Add it here.");
    expect(message?.text).toContain("A run landed on Strava at");
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("skips it once a matching upload has paired the reminder", async () => {
    const { userId, athleteId } = await connectedRunner();
    await deliver(reminderJob(athleteId));
    const runId = newUlid();
    const ended = nowSeconds() - 60;
    await core()
      .insert(runs)
      .values({
        id: runId,
        userId,
        source: "file",
        startedAt: ended - 1800,
        durationS: 1800,
        distanceM: 5000,
        title: "Morning run",
      });
    const pairing = pairWithReminder(core(), userId, runId, ended);
    await core().batch([pairing.pairRun, pairing.markRead]);

    const mail = fakeMail();
    await drainLater(mail);
    expect(
      mail.sent.filter((m) => m.subject.startsWith("New run on Strava")),
    ).toHaveLength(0);
    // Settled, not left owed: the row goes and nothing retries it.
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("skips it when the runner switched reminder emails off", async () => {
    const { userId, athleteId } = await connectedRunner();
    await setEmailPreference(core(), userId, "run_reminder", false);
    await deliver(reminderJob(athleteId));
    const mail = fakeMail();
    await drainLater(mail);
    expect(mail.sent).toStrictEqual([]);
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("skips it for an address not yet confirmed", async () => {
    const { userId, athleteId } = await connectedRunner({ isVerified: false });
    await deliver(reminderJob(athleteId));
    const mail = fakeMail();
    await drainLater(mail);
    expect(mail.sent).toStrictEqual([]);
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("skips an email whose bell row is gone, and sends one without a bell row to repeat", async () => {
    const { userId } = await seedUser();
    const template = {
      kind: "run_reminder",
      landedAt: "6:58 AM",
      runs: 1,
    } as const;
    const gone = `run_reminder:${userId}:gone`;
    const plain = `run_reminder:${userId}:plain`;
    const owedGone = emailDebt(
      { to: { userId }, template },
      { dedupeKey: gone, unlessRead: newUlid() },
    );
    const owedPlain = emailDebt(
      { to: { userId }, template },
      { dedupeKey: plain },
    );
    await core().batch([
      outboxInsert(core(), oweOutbox(owedGone)),
      outboxInsert(core(), oweOutbox(owedPlain)),
    ]);
    const mail = fakeMail();
    await drainLater(mail);
    expect(mail.sent).toHaveLength(1);
    expect(await owedFor(userId)).toStrictEqual([]);
  });
});

async function seedRun(
  userId: string,
  startedAt: number,
  place: { lat: number; lng: number } | undefined,
  // "unnamed" stores an observation with no zone; omitted, none at all.
  timeZone?: string,
): Promise<void> {
  await core().insert(runs).values({
    id: newUlid(),
    userId,
    source: "file",
    startedAt,
    durationS: 1800,
    distanceM: 5000,
    title: "Run",
    lat: place?.lat,
    lng: place?.lng,
  });
  if (place === undefined || timeZone === undefined) return;
  await drizzle(env.DIALED_WEATHER)
    .insert(weatherObservations)
    .values({
      id: newUlid(),
      ...cacheKeyFor(place.lat, place.lng, new Date(startedAt * 1000)),
      tempC: 7,
      feelsLikeC: 5,
      humidity: 80,
      windKph: 10,
      precipMm: 0,
      condition: "Clear",
      source: "visualcrossing",
      fetchedAt: startedAt,
      timeZone,
    });
}

const seeded = { places: 0 };

/**
A new place per seeded run, so no two seed the same cache cell.
*/
function place(): { lat: number; lng: number } {
  seeded.places += 1;
  return { lat: 10 + seeded.places * 0.5, lng: -100 - seeded.places * 0.5 };
}

describe("runnerZone: the zone of the runner's latest observed run", () => {
  it("is undefined for a runner with no runs", async () => {
    expect(await runnerZone(core(), newUlid())).toBeUndefined();
  });

  it("takes the latest run that names a zone, past indoor runs and unobserved ones", async () => {
    const userId = newUlid();
    const day = 24 * HOUR;
    const base = nowSeconds() - 30 * day;
    await seedRun(userId, base, place(), "Europe/Berlin");
    await seedRun(userId, base + day, place(), CHICAGO);
    await seedRun(userId, base + 2 * day, place(), "unnamed");
    await seedRun(userId, base + 3 * day, place());
    for (let index = 0; index < 5; index += 1) {
      await seedRun(userId, base + (4 + index) * day, undefined);
    }
    expect(await runnerZone(core(), userId)).toBe(CHICAGO);
  });

  it("never reads another runner's runs", async () => {
    const other = newUlid();
    await seedRun(other, nowSeconds() - HOUR, place(), CHICAGO);
    expect(await runnerZone(core(), newUlid())).toBeUndefined();
  });
});
