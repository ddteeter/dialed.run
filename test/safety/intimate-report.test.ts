import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  entryPhotos,
  outbox,
  outfitEntries,
  reports,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import {
  fileReport,
  isQueuedForReview,
  pendingReviewQueue,
  reconcileUnhiddenReports,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";
import { oweInCore } from "../queue-fakes";

/**
 * Design 136 (D-117): an intimate image shared without consent is hidden
 * from everyone on the first report, and every operator is told by email
 * when its removal is due — 48 hours on, the TAKE IT DOWN Act's limit.
 */
const DAY_S = 24 * 60 * 60;
const ADMINS = env.ADMIN_USER_IDS;

function core() {
  return drizzle(env.DIALED_CORE);
}

async function entry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
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

async function entryStatus(entryId: string): Promise<string | undefined> {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

async function photoStatus(photoId: string): Promise<string | undefined> {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return row?.status;
}

/**
 * Every owed email's payload, read through the outbox's own parser — so a
 * debt the drain could not send fails here too.
 */
async function owedEmails(): Promise<unknown[]> {
  const rows = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows.map((row) => {
    const read = readOutboxRow("email", row.payload);
    if (!read.ok) throw new Error(read.problem);
    return read.message.payload;
  });
}

const dueTemplate = z.object({ dueAt: z.number() });
const dueOf = z.object({ email: z.object({ template: dueTemplate }) });

function alert(
  admin: string,
  subjectType: "entry" | "photo",
  subjectId: string,
  dueAt: number,
) {
  return {
    dedupeKey: `removal_due:${subjectType}:${subjectId}:${admin}`,
    email: {
      to: { userId: admin },
      template: { kind: "removal_due", subject: subjectType, dueAt },
    },
  };
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(outbox);
});

afterEach(() => {
  if (ADMINS === undefined) Reflect.deleteProperty(env, "ADMIN_USER_IDS");
  else Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("one report of an intimate image", () => {
  it("hides the entry from everyone, queues it, and owes each operator an alert due in 48 hours", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one, op-two");
    const entryId = await entry();
    const before = nowSeconds();

    const result = await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "intimate",
      },
      oweInCore,
    );

    expect(result).toStrictEqual({
      status: "filed",
      reporterCount: 1,
      hiddenPendingReview: true,
    });
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await isQueuedForReview("entry", entryId)).toBe(true);
    const owed = await owedEmails();
    expect(owed).toHaveLength(2);
    const dueAt = dueOf.parse(owed[0]).email.template.dueAt;
    expect(dueAt).toBeGreaterThanOrEqual(before + 2 * DAY_S);
    expect(dueAt).toBeLessThanOrEqual(nowSeconds() + 2 * DAY_S);
    expect(owed).toStrictEqual([
      alert("op-one", "entry", entryId, dueAt),
      alert("op-two", "entry", entryId, dueAt),
    ]);
  });

  it("hides a photo the same way, and the alert names a photo", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const photoId = await photoOn(await entry());

    await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "photo",
        subjectId: photoId,
        reason: "intimate",
      },
      oweInCore,
    );

    expect(await photoStatus(photoId)).toBe("hidden_pending_review");
    expect(await owedEmails()).toMatchObject([
      { email: { template: { kind: "removal_due", subject: "photo" } } },
    ]);
  });

  it("queues a profile for a person without an alert, since it hides nothing", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const profile = await makeUser();

    const result = await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "profile",
        subjectId: profile,
        reason: "intimate",
      },
      oweInCore,
    );

    expect(result.hiddenPendingReview).toBe(true);
    expect(await isQueuedForReview("profile", profile)).toBe(true);
    expect(await owedEmails()).toStrictEqual([]);
  });

  it("hides but alerts nobody when no operator is configured", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "");
    const entryId = await entry();

    await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "intimate",
      },
      oweInCore,
    );

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await owedEmails()).toStrictEqual([]);
  });
});

describe("every other reason", () => {
  it("still waits for three people, and never alerts", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const entryId = await entry();

    const once = await fileReport(
      {
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      oweInCore,
    );
    expect(once.hiddenPendingReview).toBe(false);
    expect(await entryStatus(entryId)).toBe("ok");

    for (let n = 0; n < 2; n += 1) {
      await fileReport(
        {
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "explicit",
        },
        oweInCore,
      );
    }
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await owedEmails()).toStrictEqual([]);
  });
});

describe("the hourly reconcile, for an intimate report whose hide never landed", () => {
  it("hides it and owes the alert, due 48 hours after the report", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const entryId = await entry();
    const reportedAt = nowSeconds() - 3600;
    await core()
      .insert(reports)
      .values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "intimate",
        createdAt: reportedAt,
      });
    // An explicit report on the same subject, later, does not move the
    // clock: it starts at the first intimate one.
    await core()
      .insert(reports)
      .values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
        createdAt: reportedAt - 60,
      });

    expect(await reconcileUnhiddenReports(oweInCore)).toStrictEqual({
      found: 1,
      hidden: 1,
    });
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await owedEmails()).toStrictEqual([
      alert("op-one", "entry", entryId, reportedAt + 2 * DAY_S),
    ]);
    expect(await reconcileUnhiddenReports(oweInCore)).toStrictEqual({
      found: 0,
      hidden: 0,
    });
  });

  it("owes no alert for a subject over the bar on ordinary reasons", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    const entryId = await entry();
    for (let n = 0; n < 3; n += 1) {
      await core()
        .insert(reports)
        .values({
          id: newUlid(),
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
          createdAt: nowSeconds(),
        });
    }

    await reconcileUnhiddenReports(oweInCore);

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await owedEmails()).toStrictEqual([]);
  });
});

describe("the Review row's clock", () => {
  it("is due 48 hours after the first intimate report, and says how long is left", async () => {
    const entryId = await entry();
    const reportedAt = nowSeconds() - 17 * 3600 - 60;
    await core()
      .insert(reports)
      .values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "intimate",
        createdAt: reportedAt,
      });
    await reconcileUnhiddenReports(oweInCore);

    const [row] = await pendingReviewQueue();
    expect(row?.dueAt).toBe(reportedAt + 2 * DAY_S);
    expect(row?.due).toBe("Due in 31h");
  });

  it("is absent from a row no intimate report started", async () => {
    const entryId = await entry();
    for (let n = 0; n < 3; n += 1) {
      await fileReport(
        {
          reporterId: await makeUser(),
          subjectType: "entry",
          subjectId: entryId,
          reason: "spam",
        },
        oweInCore,
      );
    }

    const [row] = await pendingReviewQueue();
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("dueAt");
    expect(row).not.toHaveProperty("due");
  });
});
