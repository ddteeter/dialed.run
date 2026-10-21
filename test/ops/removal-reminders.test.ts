import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  cronCheckpoints,
  outbox,
  reports,
  reviewQueue,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { handleScheduled } from "../../src/modules/ops";
import {
  oweRemindersSince,
  oweRemovalReminders,
} from "../../src/modules/ops/removal-reminders";

/**
 * C6's 40-hour reminder: an undecided removal is emailed to every
 * operator once more when 8 of its 48 hours are left — once, however
 * often the hourly firing runs (law 1).
 */
const HOUR = 3600;
const NOW = 1_800_000_000;
const ADMINS = env.ADMIN_USER_IDS;
const MARK = "removal-reminders";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
A `/takedown` request filed `hoursAgo` hours before NOW, due 48 hours after it.
*/
async function request(
  hoursAgo: number,
  overrides: Partial<typeof takedownRequests.$inferInsert> = {},
): Promise<string> {
  const id = newUlid();
  const createdAt = NOW - Math.round(hoursAgo * HOUR);
  await core()
    .insert(takedownRequests)
    .values({
      id,
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location: "https://elsewhere.example/img",
      dueAt: createdAt + 48 * HOUR,
      createdAt,
      idempotencyKey: newUlid(),
      holdState: "held",
      ...overrides,
    });
  return id;
}

/**
 * A photo's Review row with one report of `reason`, `hoursAgo` hours
 * before NOW: an intimate one starts the 48 hours.
 */
async function reported(
  hoursAgo: number,
  options: {
    reason?: "intimate" | "spam";
    status?: "pending" | "reviewing" | "approved";
  } = {},
): Promise<string> {
  const subjectId = newUlid();
  const createdAt = NOW - hoursAgo * HOUR;
  await core()
    .insert(reports)
    .values({
      id: newUlid(),
      reporterId: newUlid(),
      subjectType: "photo",
      subjectId,
      reason: options.reason ?? "intimate",
      createdAt,
    });
  await core()
    .insert(reviewQueue)
    .values({
      id: newUlid(),
      subjectType: "photo",
      subjectId,
      source: "reports",
      status: options.status ?? "pending",
      createdAt,
    });
  return subjectId;
}

const owedEmail = z.object({
  dedupeKey: z.string(),
  email: z.object({ to: z.unknown(), template: z.unknown() }),
});

async function reminders() {
  const rows = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows
    .map((row) => {
      const read = readOutboxRow("email", row.payload);
      if (!read.ok) throw new Error(read.problem);
      return owedEmail.parse(read.message.payload);
    })
    .filter((email) => email.dedupeKey.startsWith("removal_reminder:"))
    .toSorted((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
}

async function keys(): Promise<string[]> {
  const owed = await reminders();
  return owed.map((email) => email.dedupeKey);
}

async function mark(): Promise<number | undefined> {
  const [row] = await core()
    .select({ at: cronCheckpoints.lastRunAt })
    .from(cronCheckpoints)
    .where(eq(cronCheckpoints.cronName, MARK));
  return row?.at;
}

beforeEach(async () => {
  await core().delete(takedownRequests);
  await core().delete(reports);
  await core().delete(reviewQueue);
  await core().delete(outbox);
  await core().delete(cronCheckpoints);
  Reflect.set(env, "ADMIN_USER_IDS", "op-one,op-two");
});

afterEach(() => {
  if (ADMINS === undefined) Reflect.deleteProperty(env, "ADMIN_USER_IDS");
  else Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("the 40-hour reminder", () => {
  it("owes every operator one for a request past 40 hours, with its deadline", async () => {
    const id = await request(40);

    await oweRemovalReminders(core(), NOW);

    const dueAt = NOW + 8 * HOUR;
    expect(await reminders()).toStrictEqual([
      {
        dedupeKey: `removal_reminder:request:${id}:op-one`,
        email: {
          to: { userId: "op-one" },
          template: { kind: "removal_reminder", dueAt },
        },
      },
      {
        dedupeKey: `removal_reminder:request:${id}:op-two`,
        email: {
          to: { userId: "op-two" },
          template: { kind: "removal_reminder", dueAt },
        },
      },
    ]);
    expect(await mark()).toBe(NOW);
  });

  it("owes nothing for a request with more than 8 hours left", async () => {
    await request(39.99);
    await oweRemovalReminders(core(), NOW);
    expect(await reminders()).toStrictEqual([]);
  });

  it("owes one for an intimate-image report past 40 hours, pending or claimed", async () => {
    const pending = await reported(40);
    const claimed = await reported(40, { status: "reviewing" });

    await oweRemovalReminders(core(), NOW);

    expect(await keys()).toStrictEqual(
      [
        `removal_reminder:photo:${claimed}:op-one`,
        `removal_reminder:photo:${claimed}:op-two`,
        `removal_reminder:photo:${pending}:op-one`,
        `removal_reminder:photo:${pending}:op-two`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(await reminders()).toMatchObject([
      { email: { template: { dueAt: NOW + 8 * HOUR } } },
      { email: { template: { dueAt: NOW + 8 * HOUR } } },
      { email: { template: { dueAt: NOW + 8 * HOUR } } },
      { email: { template: { dueAt: NOW + 8 * HOUR } } },
    ]);
  });

  it("owes nothing for what is decided, or never started the 48 hours", async () => {
    await request(41, { status: "removed" });
    await request(41, { status: "declined" });
    await reported(41, { status: "approved" });
    await reported(41, { reason: "spam" });
    await reported(39);

    await oweRemovalReminders(core(), NOW);

    expect(await reminders()).toStrictEqual([]);
  });

  it("owes nothing for a request that alerted nobody: blocked, or waiting on its confirm", async () => {
    await request(41, { holdState: "blocked" });
    await request(41, { holdState: "confirm" });

    await oweRemovalReminders(core(), NOW);

    expect(await reminders()).toStrictEqual([]);
  });

  it("reminds of a request the valve quieted, and one whose link is not ours", async () => {
    const valve = await request(41, { holdState: "valve" });
    // A link that is not ours stores no hold state.
    const notOurs = await request(41, { holdState: undefined });

    await oweRemovalReminders(core(), NOW);

    expect(await keys()).toStrictEqual(
      [
        `removal_reminder:request:${valve}:op-one`,
        `removal_reminder:request:${valve}:op-two`,
        `removal_reminder:request:${notOurs}:op-one`,
        `removal_reminder:request:${notOurs}:op-two`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("on its first firing, reminds of an overdue removal too", async () => {
    const overdue = await request(60);
    const report = await reported(60);

    await oweRemovalReminders(core(), NOW);

    expect(await keys()).toStrictEqual(
      [
        `removal_reminder:request:${overdue}:op-one`,
        `removal_reminder:request:${overdue}:op-two`,
        `removal_reminder:photo:${report}:op-one`,
        `removal_reminder:photo:${report}:op-two`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
  });
});

describe("once per removal", () => {
  it("owes nothing again an hour later, after the first was sent", async () => {
    await request(40);
    await reported(40);
    await oweRemovalReminders(core(), NOW);
    // Sent: the drain deletes a sent row, so the dedupe key alone would
    // not stop a second.
    await core().delete(outbox);

    await oweRemovalReminders(core(), NOW + HOUR);

    expect(await reminders()).toStrictEqual([]);
    expect(await mark()).toBe(NOW + HOUR);
  });

  it("reminds next hour of only what crossed 40 hours since", async () => {
    await request(40);
    await reported(40);
    await oweRemovalReminders(core(), NOW);
    await core().delete(outbox);
    const later = await request(39.5);
    const laterReport = await reported(39.5);
    // Inside the next hour's window by a second, and outside it by one.
    const edge = await request(39);
    await request(39 - 1 / HOUR);

    await oweRemovalReminders(core(), NOW + HOUR);

    expect(await keys()).toStrictEqual(
      [
        `removal_reminder:request:${later}:op-one`,
        `removal_reminder:request:${later}:op-two`,
        `removal_reminder:request:${edge}:op-one`,
        `removal_reminder:request:${edge}:op-two`,
        `removal_reminder:photo:${laterReport}:op-one`,
        `removal_reminder:photo:${laterReport}:op-two`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("owes nothing when another firing moved the mark since this one read it", async () => {
    await request(41);
    await reported(41);
    await core()
      .insert(cronCheckpoints)
      .values({ cronName: MARK, lastRunAt: NOW - 10 });

    // Read 20 hours ago, but the mark is `NOW - 10`: another firing's claim.
    await oweRemindersSince(core(), NOW - 20 * HOUR, NOW);

    expect(await reminders()).toStrictEqual([]);
    expect(await mark()).toBe(NOW - 10);
  });

  it("owes nothing when another first firing marked before this one", async () => {
    await request(41);
    await core()
      .insert(cronCheckpoints)
      .values({ cronName: MARK, lastRunAt: NOW - 10 });

    await oweRemindersSince(core(), undefined, NOW);

    expect(await reminders()).toStrictEqual([]);
    expect(await mark()).toBe(NOW - 10);
  });
});

describe("the hourly firing", () => {
  it("owes the reminder on the :00 firing", async () => {
    const now = nowSeconds();
    const id = newUlid();
    await core()
      .insert(takedownRequests)
      .values({
        id,
        requesterEmail: "sam@example.com",
        signature: "Sam Runner",
        location: "https://elsewhere.example/img",
        dueAt: now + 7 * HOUR,
        createdAt: now - 41 * HOUR,
        idempotencyKey: newUlid(),
      });

    await handleScheduled({ cron: "0 * * * *" } as ScheduledController);

    expect(await keys()).toStrictEqual([
      `removal_reminder:request:${id}:op-one`,
      `removal_reminder:request:${id}:op-two`,
    ]);
  });
});
