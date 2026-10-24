import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  entryPhotos,
  notifications,
  outbox,
  outfitEntries,
  reports,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, ulidSchema, type Ulid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { decideReview } from "../../src/modules/feed/moderation";
import {
  fileReport,
  reconcileUnhiddenReports,
  type ReportReason,
  type ReportSubjectType,
} from "../../src/modules/safety";
import {
  HIDDEN_NOTICE,
  REPORT_OUTCOME,
} from "../../src/modules/safety/notice-copy";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";
import { oweInCore } from "../queue-fakes";

/**
 * C8 (D-132, D-145): the notices a report's life owes — the author's when
 * a report hides their kit or photo and when a person leaves it up, and
 * each reporter's when a person decides. Suspected CSAM tells nobody.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
A runner with an account, so an email owed to them has an address.
*/
async function addressed(): Promise<string> {
  const userId = await makeUser();
  await core()
    .insert(user)
    .values({
      id: userId,
      name: userId,
      email: `${userId.toLowerCase()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return userId;
}

async function entryOf(author: string): Promise<string> {
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

async function photoOn(
  entryId: string,
  screenStatus: "pass" | "removed" = "pass",
): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}.jpg`,
      position: 0,
      screenStatus,
    });
  return id;
}

async function report(
  subjectType: ReportSubjectType,
  subjectId: string,
  reason: ReportReason = "intimate",
  reporterId?: string,
): Promise<string> {
  const reporter = reporterId ?? (await makeUser());
  await fileReport(
    { reporterId: reporter, subjectType, subjectId, reason },
    oweInCore,
  );
  return reporter;
}

/**
A report row written directly, as a crash before the hide would leave it.
*/
async function reportRow(
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<string> {
  const reporterId = await makeUser();
  await core().insert(reports).values({
    id: newUlid(),
    reporterId,
    subjectType,
    subjectId,
    reason: "spam",
    createdAt: nowSeconds(),
  });
  return reporterId;
}

async function queueRowOf(subjectId: string): Promise<Ulid> {
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subjectId));
  if (row === undefined) throw new Error("not queued");
  return ulidSchema.parse(row.id);
}

async function queued(
  subjectType: ReportSubjectType,
  subjectId: string,
  source: "reports" | "classifier",
): Promise<Ulid> {
  const id = newUlid();
  await core().insert(reviewQueue).values({
    id,
    subjectType,
    subjectId,
    source,
    status: "pending",
    createdAt: nowSeconds(),
  });
  return id;
}

async function told(userId: string) {
  return core()
    .select({
      kind: notifications.kind,
      subjectId: notifications.subjectId,
      body: notifications.body,
      read: notifications.read,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function kindsTold(userId: string): Promise<string[]> {
  const rows = await told(userId);
  return rows.map((notice) => notice.kind);
}

async function bodiesTold(userId: string): Promise<string[]> {
  const rows = await told(userId);
  return rows.map((notice) => notice.body);
}

async function toldOf(userId: string, kind: string) {
  const rows = await told(userId);
  return rows.filter((notice) => notice.kind === kind);
}

async function owedTemplate(): Promise<unknown> {
  const rows = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  const templates = rows.flatMap((row) => {
    const read = readOutboxRow("email", row.payload);
    return read.ok && read.message.kind === "email"
      ? [read.message.payload.email.template]
      : [];
  });
  return templates.find((template) => template.kind === "content_removed");
}

beforeEach(async () => {
  await resetSafetyTables();
});

describe("the author's notice when a report hides their thing (D-145)", () => {
  it("tells a kit's author, in the bell, once it is hidden", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);

    const reporter = await report("entry", entryId);

    expect(await told(author)).toStrictEqual([
      {
        kind: "content_hidden",
        subjectId: entryId,
        body: "Kit hidden while we review it. Someone reported a kit you shared, so other runners can't see it until a person reviews it, usually within a day. It was hidden automatically. We'll tell you what we decide.",
        read: false,
      },
    ]);
    // The reporter is told nothing until a person decides.
    expect(await told(reporter)).toStrictEqual([]);
  });

  it("tells a photo's author in the owner's words", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));

    await report("photo", photoId);

    expect(await told(author)).toStrictEqual([
      {
        kind: "content_hidden",
        subjectId: photoId,
        body: "Photo hidden while we review it. Someone reported a photo on your run, so other runners can't see it until a person reviews it, usually within a day. It was hidden automatically. We'll tell you what we decide.",
        read: false,
      },
    ]);
    expect(await bodiesTold(author)).toStrictEqual([HIDDEN_NOTICE.photo]);
  });

  it("says nothing until the report that hides it", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));

    await report("photo", photoId, "spam");
    await report("photo", photoId, "spam");
    expect(await told(author)).toStrictEqual([]);

    await report("photo", photoId, "spam");
    expect(await kindsTold(author)).toStrictEqual(["content_hidden"]);
  });

  it("tells them when the reconcile sweep is what hides it", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    for (let n = 0; n < 3; n += 1) await reportRow("entry", entryId);

    await reconcileUnhiddenReports(oweInCore);

    expect(await bodiesTold(author)).toStrictEqual([HIDDEN_NOTICE.entry]);
  });

  it("tells nobody of a hide that hid nothing: a copyright takedown's", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    const heldPhoto = await photoOn(entryId, "removed");
    const removedEntry = await entryOf(author);
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, removedEntry));

    await report("photo", heldPhoto);
    await report("entry", removedEntry);

    expect(await told(author)).toStrictEqual([]);
  });

  it("has nobody to tell for a profile, which a report never hides", async () => {
    const runner = await makeUser();

    await report("profile", runner);

    expect(await core().select().from(notifications)).toStrictEqual([]);
  });

  it("tells them again when a kit left up is hidden again", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    await report("entry", entryId);
    await core().update(notifications).set({ read: true });
    await decideReview(core(), "op", {
      queueId: await queueRowOf(entryId),
      action: "approve",
    });

    await report("entry", entryId);

    const hidden = await toldOf(author, "content_hidden");
    expect(hidden).toStrictEqual([
      {
        kind: "content_hidden",
        subjectId: entryId,
        body: HIDDEN_NOTICE.entry,
        read: false,
      },
    ]);
  });
});

describe("what a decision tells (D-132)", () => {
  beforeEach(() => {
    vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells each reporter and the author it stayed up, once", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    const first = await report("entry", entryId, "spam");
    const second = await report("entry", entryId, "spam");
    const third = await report("entry", entryId, "spam");
    const queueId = await queueRowOf(entryId);

    expect(
      await decideReview(core(), "op", { queueId, action: "approve" }),
    ).toBe("resolved");
    expect(
      await decideReview(core(), "op", { queueId, action: "approve" }),
    ).toBe("already_resolved");

    for (const reporter of [first, second, third]) {
      expect(await told(reporter)).toStrictEqual([
        {
          kind: "report_kept",
          subjectId: entryId,
          body: "We reviewed what you reported and left it up. We didn't find that it breaks our community rules. Disagree? Write to desk@dialed.run.",
          read: false,
        },
      ]);
    }
    expect(await toldOf(author, "content_kept")).toStrictEqual([
      {
        kind: "content_kept",
        subjectId: entryId,
        body: "We reviewed your reported kit and left it up.",
        read: false,
      },
    ]);
  });

  it("tells a photo's author in the photo's words", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));
    await report("photo", photoId);

    await decideReview(core(), "op", {
      queueId: await queueRowOf(photoId),
      action: "approve",
    });

    expect(await toldOf(author, "content_kept")).toStrictEqual([
      {
        kind: "content_kept",
        subjectId: photoId,
        body: "We reviewed the reported photo on your run and left it up.",
        read: false,
      },
    ]);
  });

  it("owes no author a 'left it up' for what the check flagged and nobody reported", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));
    const queueId = await queued("photo", photoId, "classifier");

    await decideReview(core(), "op", { queueId, action: "approve" });

    expect(await told(author)).toStrictEqual([]);
  });

  it("tells each reporter it was removed, and the email says a person found it", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    const reporter = await report("entry", entryId);

    await decideReview(core(), "op", {
      queueId: await queueRowOf(entryId),
      action: "remove",
      reason: "spam",
    });

    expect(await told(reporter)).toStrictEqual([
      {
        kind: "report_removed",
        subjectId: entryId,
        body: REPORT_OUTCOME.removed,
        read: false,
      },
    ]);
    expect(REPORT_OUTCOME.removed).toBe("We removed what you reported.");
    expect(await owedTemplate()).toMatchObject({
      rule: "spam",
      flagged: false,
    });
  });

  it("says the automatic check flagged it when the check is what queued it", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));
    // Another subject's flag does not count for this one.
    await queued("photo", await photoOn(await entryOf(author)), "reports");
    const queueId = await queued("photo", photoId, "classifier");

    await decideReview(core(), "op", {
      queueId,
      action: "remove",
      reason: "explicit",
    });

    expect(await owedTemplate()).toMatchObject({
      rule: "explicit",
      flagged: true,
    });
  });

  it("says a person found it when another subject was the one the check flagged", async () => {
    const author = await addressed();
    const photoId = await photoOn(await entryOf(author));
    await queued("photo", await photoOn(await entryOf(author)), "classifier");
    const queueId = await queued("photo", photoId, "reports");

    await decideReview(core(), "op", {
      queueId,
      action: "remove",
      reason: "explicit",
    });

    expect(await owedTemplate()).toMatchObject({ flagged: false });
  });

  it("tells nobody of a quarantine: not the reporter, not the author (D-70)", async () => {
    const author = await addressed();
    const entryId = await entryOf(author);
    const reporter = await report("entry", entryId);
    await core().delete(notifications);

    await decideReview(core(), "op", {
      queueId: await queueRowOf(entryId),
      action: "quarantine",
      reason: "explicit",
    });

    expect(await core().select().from(notifications)).toStrictEqual([]);
    expect(await told(reporter)).toStrictEqual([]);
  });

  it("tells a product's reporters it went, or that it stayed", async () => {
    const removed = newUlid();
    const kept = newUlid();
    const removedBy = await reportRow("product", removed);
    const keptBy = await reportRow("product", kept);

    await decideReview(core(), "op", {
      queueId: await queued("product", removed, "reports"),
      action: "remove",
      reason: "spam",
    });
    await decideReview(core(), "op", {
      queueId: await queued("product", kept, "reports"),
      action: "approve",
    });

    expect(await kindsTold(removedBy)).toStrictEqual(["report_removed"]);
    expect(await kindsTold(keptBy)).toStrictEqual(["report_kept"]);
  });

  it("tells a profile's reporters nothing on Remove, which changes nothing about the profile", async () => {
    const runner = await makeUser();
    const reporter = await reportRow("profile", runner);

    await decideReview(core(), "op", {
      queueId: await queued("profile", runner, "reports"),
      action: "remove",
      reason: "harassment",
    });

    expect(await told(reporter)).toStrictEqual([]);
  });

  it("tells nobody of a product quarantined", async () => {
    const product = newUlid();
    const reporter = await reportRow("product", product);

    await decideReview(core(), "op", {
      queueId: await queued("product", product, "reports"),
      action: "quarantine",
      reason: "explicit",
    });

    expect(await told(reporter)).toStrictEqual([]);
  });
});
