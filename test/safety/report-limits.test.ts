import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountDeletions,
  blocks,
  entryPhotos,
  notifications,
  outbox,
  outfitEntries,
  rateLimits,
  reports,
  reviewQueue,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  reconcileUnhiddenReports,
  resolveReview,
} from "../../src/modules/safety";
import {
  AT_ONCE_HIDES_PER_DAY,
  REPORTS_PER_DAY,
} from "../../src/modules/safety/rules/contracts";
import { claimForReview } from "../../src/modules/safety/review/review";
import { fileReport } from "../../src/modules/safety/reports/reports";
import type { FileReportInput } from "../../src/modules/safety/reports/reports";

import { noPurge } from "../purge-spy";
import { oweInCore } from "../queue-fakes";
import {
  makeEntry,
  makeProduct,
  makeRun,
  makeUser,
  makeVerifiedUser,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 232: a report names something its reporter can see, a reporter
 * files a bounded number a day, and a repeat changes nothing.
 */
const DAY_S = 24 * 60 * 60;
const ADMINS = env.ADMIN_USER_IDS;

function core() {
  return drizzle(env.DIALED_CORE);
}

async function kit(
  audience: "private" | "runners" = "runners",
  author?: string,
): Promise<string> {
  const userId = author ?? (await makeUser());
  const runId = await makeRun({ userId });
  return makeEntry({ userId, runId, audience });
}

async function photoOn(entryId: string): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}.jpg`,
      position: 0,
      screenStatus: "pass",
    });
  return id;
}

async function statusOf(entryId: string): Promise<string | undefined> {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

async function queueRowOf(subjectId: string) {
  const [row] = await core()
    .select({ status: reviewQueue.status, hid: reviewQueue.hid })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subjectId));
  return row;
}

function report(input: FileReportInput) {
  return fileReport(input, oweInCore, noPurge);
}

/**
A count already standing for `reporterId`, as if filed `ago` seconds back.
*/
async function standing(
  kind: "report-runner" | "report-at-once",
  reporterId: string,
  count: number,
  ago: number,
): Promise<void> {
  await core()
    .insert(rateLimits)
    .values({
      kind,
      subject: reporterId,
      windowStartedAt: nowSeconds() - ago,
      count,
    });
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(outbox);
  await core().delete(rateLimits);
  await core().delete(notifications);
});

afterEach(() => {
  if (ADMINS === undefined) Reflect.deleteProperty(env, "ADMIN_USER_IDS");
  else Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("what a report may name (design 232)", () => {
  it("files nothing, queues nothing and owes nothing for an id that names no kit", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const reporter = await makeUser();
    const nothing = newUlid();

    const result = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: nothing,
      reason: "intimate",
    });

    expect(result).toStrictEqual({ status: "not_found" });
    expect(await core().select().from(reports)).toStrictEqual([]);
    expect(await core().select().from(reviewQueue)).toStrictEqual([]);
    expect(await core().select().from(outbox)).toStrictEqual([]);
    // Not counted against the reporter either.
    expect(await core().select().from(rateLimits)).toStrictEqual([]);
  });

  it("refuses another runner's private kit and its photo", async () => {
    const privateKit = await kit("private");
    const photo = await photoOn(privateKit);
    const reporter = await makeUser();

    const onKit = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: privateKit,
      reason: "intimate",
    });
    const onPhoto = await report({
      reporterId: reporter,
      subjectType: "photo",
      subjectId: photo,
      reason: "intimate",
    });

    expect(onKit).toStrictEqual({ status: "not_found" });
    expect(onPhoto).toStrictEqual({ status: "not_found" });
    expect(await statusOf(privateKit)).toBe("ok");
  });

  it("refuses a photo id that names no photo", async () => {
    await photoOn(await kit());

    const result = await report({
      reporterId: await makeUser(),
      subjectType: "photo",
      subjectId: newUlid(),
      reason: "intimate",
    });

    expect(result).toStrictEqual({ status: "not_found" });
    expect(await core().select().from(reports)).toStrictEqual([]);
  });

  it("takes a report of the reporter's own private kit", async () => {
    const author = await makeUser();
    const ownKit = await kit("private", author);

    const result = await report({
      reporterId: author,
      subjectType: "entry",
      subjectId: ownKit,
      reason: "intimate",
    });

    expect(result).toMatchObject({ status: "filed", reporterCount: 1 });
  });

  it("takes a report of a photo on a shared kit", async () => {
    const photo = await photoOn(await kit());

    const result = await report({
      reporterId: await makeUser(),
      subjectType: "photo",
      subjectId: photo,
      reason: "intimate",
    });

    expect(result).toMatchObject({ status: "filed", reporterCount: 1 });
  });

  it("refuses a profile or a product that does not exist, and takes ones that do", async () => {
    const reporter = await makeUser();

    expect(
      await report({
        reporterId: reporter,
        subjectType: "profile",
        subjectId: newUlid(),
        reason: "offensive",
      }),
    ).toStrictEqual({ status: "not_found" });
    expect(
      await report({
        reporterId: reporter,
        subjectType: "product",
        subjectId: newUlid(),
        reason: "spam",
      }),
    ).toStrictEqual({ status: "not_found" });
    expect(
      await report({
        reporterId: reporter,
        subjectType: "profile",
        subjectId: await makeVerifiedUser(),
        reason: "offensive",
      }),
    ).toMatchObject({ status: "filed" });
    expect(
      await report({
        reporterId: reporter,
        subjectType: "product",
        subjectId: await makeProduct(),
        reason: "spam",
      }),
    ).toMatchObject({ status: "filed" });
  });

  it("refuses a profile the reporter could not see: closed, leaving, unconfirmed or in a block", async () => {
    const reporter = await makeUser();
    const closed = await makeVerifiedUser();
    await core()
      .update(userProfiles)
      .set({ bannedAt: 1 })
      .where(eq(userProfiles.userId, closed));
    const leaving = await makeVerifiedUser();
    await core()
      .insert(accountDeletions)
      .values({ userId: leaving, requestedAt: 1, purgeAfter: 2 });
    const unconfirmed = await makeUser();
    const blockedThem = await makeVerifiedUser();
    const blockedMe = await makeVerifiedUser();
    await core()
      .insert(blocks)
      .values([
        { blockerId: reporter, blockedId: blockedThem, createdAt: 1 },
        { blockerId: blockedMe, blockedId: reporter, createdAt: 1 },
      ]);

    for (const subjectId of [
      closed,
      leaving,
      unconfirmed,
      blockedThem,
      blockedMe,
    ]) {
      expect(
        await report({
          reporterId: reporter,
          subjectType: "profile",
          subjectId,
          reason: "offensive",
        }),
      ).toStrictEqual({ status: "not_found" });
    }
    expect(await core().select().from(reports)).toStrictEqual([]);
  });

  it("still files, queues and alerts on a shared kit already hidden for another reason", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const hiddenKit = await kit();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, hiddenKit));

    const result = await report({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: hiddenKit,
      reason: "intimate",
    });

    expect(result).toMatchObject({
      status: "filed",
      hiddenPendingReview: true,
    });
    expect(await queueRowOf(hiddenKit)).toMatchObject({ status: "pending" });
    expect(await core().select().from(outbox)).toHaveLength(1);
  });
});

describe("a reporter's reports a day (design 232)", () => {
  it("files REPORTS_PER_DAY and refuses the next, writing nothing for it", async () => {
    const reporter = await makeUser();
    await standing("report-runner", reporter, REPORTS_PER_DAY - 1, 60);
    const last = await kit();
    const over = await kit();

    const within = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: last,
      reason: "spam",
    });
    const past = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: over,
      reason: "spam",
    });

    expect(within).toMatchObject({ status: "filed" });
    expect(past).toStrictEqual({ status: "limited" });
    const filed = await core()
      .select({ subjectId: reports.subjectId })
      .from(reports);
    expect(filed).toStrictEqual([{ subjectId: last }]);
  });

  it("counts the whole day, and starts over once it is past", async () => {
    const reporter = await makeUser();
    const other = await makeUser();
    await standing("report-runner", reporter, REPORTS_PER_DAY, DAY_S - 60);
    await standing("report-runner", other, REPORTS_PER_DAY, DAY_S + 60);

    const stillToday = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: await kit(),
      reason: "spam",
    });
    const nextDay = await report({
      reporterId: other,
      subjectType: "entry",
      subjectId: await kit(),
      reason: "spam",
    });

    expect(stillToday).toStrictEqual({ status: "limited" });
    expect(nextDay).toMatchObject({ status: "filed" });
  });

  it("files no more than REPORTS_PER_DAY when they arrive at once", async () => {
    const reporter = await makeUser();
    const kits = await Promise.all(
      Array.from({ length: REPORTS_PER_DAY + 3 }, () => kit()),
    );

    const results = await Promise.all(
      kits.map((subjectId) =>
        report({
          reporterId: reporter,
          subjectType: "entry",
          subjectId,
          reason: "spam",
        }),
      ),
    );

    const limited = results.filter((result) => result.status === "limited");
    expect(limited).toHaveLength(3);
    expect(await core().select().from(reports)).toHaveLength(REPORTS_PER_DAY);
  });

  it("hides at once AT_ONCE_HIDES_PER_DAY times, then files and queues with the alert but hides nothing", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const reporter = await makeUser();
    await standing("report-at-once", reporter, AT_ONCE_HIDES_PER_DAY - 1, 60);
    const last = await kit();
    const over = await kit();

    const within = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: last,
      reason: "intimate",
    });
    const past = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: over,
      reason: "intimate",
    });

    expect(within).toMatchObject({ hiddenPendingReview: true });
    expect(await statusOf(last)).toBe("hidden_pending_review");
    expect(past).toMatchObject({ status: "filed", hiddenPendingReview: false });
    expect(await statusOf(over)).toBe("ok");
    expect(await queueRowOf(over)).toStrictEqual({ status: "pending", hid: 0 });
    const alerts = await core()
      .select({ dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .where(eq(outbox.dedupeKey, `removal_due:entry:${over}:op-one`));
    expect(alerts).toHaveLength(1);
  });

  it("counts a day of hides at once, and starts over once it is past", async () => {
    const reporter = await makeUser();
    const other = await makeUser();
    await standing(
      "report-at-once",
      reporter,
      AT_ONCE_HIDES_PER_DAY,
      DAY_S - 60,
    );
    await standing("report-at-once", other, AT_ONCE_HIDES_PER_DAY, DAY_S + 60);
    const today = await kit();
    const tomorrow = await kit();

    await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: today,
      reason: "intimate",
    });
    await report({
      reporterId: other,
      subjectType: "entry",
      subjectId: tomorrow,
      reason: "intimate",
    });

    expect(await statusOf(today)).toBe("ok");
    expect(await statusOf(tomorrow)).toBe("hidden_pending_review");
  });

  it("leaves another reason's hide to the breaker, not to the at-once count", async () => {
    const reporter = await makeUser();
    await standing("report-at-once", reporter, AT_ONCE_HIDES_PER_DAY, 60);
    const subject = await kit();

    // The test config's bar for `explicit`: as many reporters as it takes.
    let result = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: subject,
      reason: "explicit",
    });
    while (result.status === "filed" && !result.hiddenPendingReview) {
      result = await report({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: subject,
        reason: "explicit",
      });
    }

    expect(await statusOf(subject)).toBe("hidden_pending_review");
  });
});

async function approvedAfterOneReport(reporter: string): Promise<string> {
  const subject = await kit();
  await report({
    reporterId: reporter,
    subjectType: "entry",
    subjectId: subject,
    reason: "intimate",
  });
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subject));
  if (row === undefined) throw new Error("nothing queued");
  const operator = await makeUser();
  await claimForReview(row.id, operator, "reports");
  await resolveReview(row.id, operator, "approve");
  await core().delete(outbox);
  return subject;
}

describe("a repeat of a report (design 232)", () => {
  it("leaves a kit a person approved up, its row decided, and owes nothing", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const reporter = await makeUser();
    const subject = await approvedAfterOneReport(reporter);

    const again = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: subject,
      reason: "intimate",
    });

    expect(again).toStrictEqual({
      status: "filed",
      reporterCount: 1,
      hiddenPendingReview: false,
    });
    expect(await statusOf(subject)).toBe("ok");
    expect(await queueRowOf(subject)).toMatchObject({ status: "approved" });
    expect(await core().select().from(outbox)).toStrictEqual([]);
  });

  it("changes nothing when the repeat names another reason", async () => {
    const reporter = await makeUser();
    const subject = await kit();
    await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: subject,
      reason: "spam",
    });

    const again = await report({
      reporterId: reporter,
      subjectType: "entry",
      subjectId: subject,
      reason: "intimate",
    });

    expect(again).toMatchObject({ hiddenPendingReview: false });
    expect(await statusOf(subject)).toBe("ok");
    const [stored] = await core()
      .select({ reason: reports.reason })
      .from(reports)
      .where(
        and(eq(reports.reporterId, reporter), eq(reports.subjectId, subject)),
      );
    expect(stored?.reason).toBe("spam");
    expect(await queueRowOf(subject)).toBeUndefined();
  });
});

const UNEQUAL_BARS = JSON.stringify({
  reports: {
    explicit: 1,
    intimate: 1,
    harassment: 3,
    spam: 3,
    not_theirs: 3,
    other: 2,
  },
  photos: {
    sexual: 0.8,
    violence: 0.8,
    "violence/graphic": 0.7,
    "self-harm": 0.7,
    "self-harm/intent": 0.7,
    "self-harm/instructions": 0.7,
  },
});

/**
Reports written straight to the table, as a crash before the hide leaves them.
*/
async function filedWithoutHide(
  subjectId: string,
  reasons: readonly ("spam" | "other")[],
): Promise<void> {
  for (const reason of reasons) {
    await core()
      .insert(reports)
      .values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId,
        reason,
        createdAt: nowSeconds(),
      });
  }
}

describe("one bar for the request and the sweep (design 232)", () => {
  let configured: unknown;
  beforeEach(() => {
    configured = Reflect.get(env, "MODERATION_THRESHOLDS");
    Reflect.set(env, "MODERATION_THRESHOLDS", UNEQUAL_BARS);
  });
  afterEach(() => {
    Reflect.set(env, "MODERATION_THRESHOLDS", configured);
  });

  it.each([
    ["other", "spam"],
    ["spam", "other"],
  ] as const)(
    "hides at the lowest bar among the reasons filed, %s then %s",
    async (first, second) => {
      const subject = await kit();

      await report({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: subject,
        reason: first,
      });
      const last = await report({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: subject,
        reason: second,
      });

      expect(last).toMatchObject({ hiddenPendingReview: true });
      expect(await statusOf(subject)).toBe("hidden_pending_review");
    },
  );

  it("leaves a lone report under its own bar alone, though another reason's bar is lower", async () => {
    const subject = await kit();
    await report({
      reporterId: await makeUser(),
      subjectType: "entry",
      subjectId: subject,
      reason: "spam",
    });

    const outcome = await reconcileUnhiddenReports(oweInCore, noPurge);

    expect(outcome.found).toBe(0);
    expect(await statusOf(subject)).toBe("ok");
  });

  it("sweeps a subject over the lowest bar among its reasons, and not one under it", async () => {
    const over = await kit();
    const under = await kit();
    await filedWithoutHide(over, ["spam", "other"]);
    await filedWithoutHide(under, ["spam", "spam"]);

    const outcome = await reconcileUnhiddenReports(oweInCore, noPurge);

    expect(outcome.found).toBe(1);
    expect(await statusOf(over)).toBe("hidden_pending_review");
    expect(await statusOf(under)).toBe("ok");
  });

  it("sweeps a subject that reached its reason's bar", async () => {
    const subject = await kit();
    await filedWithoutHide(subject, ["spam", "spam", "spam"]);

    const outcome = await reconcileUnhiddenReports(oweInCore, noPurge);

    expect(outcome.found).toBe(1);
  });
});
