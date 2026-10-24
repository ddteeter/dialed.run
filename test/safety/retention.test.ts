import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  copyrightHolds,
  moderationActions,
  quarantinedContent,
  reports,
  reviewQueue,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  MODERATION_RECORD_KEPT_SECONDS,
  moderationRecordDeletes,
  sweepModerationRecords,
} from "../../src/modules/safety/retention";

/**
 * D-131's 3 years (design 150): takedown requests, reports and the records
 * of moderation decisions go 3 years after the decision, and a row exactly
 * on the line stays. Every row here is written straight to its table, as
 * the module that owns it leaves it, and each test reads the tables back.
 */

const db = drizzle(env.DIALED_CORE);
const NOW = 1_900_000_000;
/**
The line: a decision at or after it is kept.
*/
const LINE = NOW - MODERATION_RECORD_KEPT_SECONDS;
const DAY = 24 * 60 * 60;

beforeEach(async () => {
  await db.batch([
    db.delete(takedownRequests),
    db.delete(reports),
    db.delete(reviewQueue),
    db.delete(copyrightHolds),
    db.delete(moderationActions),
    db.delete(quarantinedContent),
  ]);
});

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

async function idsIn(table: SQLiteTable, idColumn: SQLiteColumn) {
  const rows = await db.select({ id: idColumn }).from(table);
  return rows.map((row) => String(row.id)).toSorted(byText);
}

const kept = {
  requests: () => idsIn(takedownRequests, takedownRequests.id),
  reports: () => idsIn(reports, reports.id),
  reviews: () => idsIn(reviewQueue, reviewQueue.id),
  holds: () => idsIn(copyrightHolds, copyrightHolds.id),
  actions: () => idsIn(moderationActions, moderationActions.id),
};

function sorted(...ids: string[]): string[] {
  return ids.toSorted(byText);
}

async function aRequest(
  resolvedAt: number | undefined,
  status: "pending" | "removed" | "declined" = "removed",
): Promise<string> {
  const id = newUlid();
  await db.insert(takedownRequests).values({
    id,
    requesterEmail: "someone@example.test",
    signature: "Some One",
    location: "https://example.test/kit",
    status,
    dueAt: LINE - 300 * DAY,
    createdAt: LINE - 302 * DAY,
    resolvedAt,
    idempotencyKey: newUlid(),
  });
  return id;
}

async function aReport(subjectId: string, createdAt: number): Promise<string> {
  const id = newUlid();
  await db.insert(reports).values({
    id,
    reporterId: newUlid(),
    subjectType: "entry",
    subjectId,
    reason: "spam",
    createdAt,
  });
  return id;
}

async function aReview(
  subjectId: string,
  resolvedAt: number | undefined,
  status: "pending" | "reviewing" | "approved" | "removed" = "approved",
): Promise<string> {
  const id = newUlid();
  await db.insert(reviewQueue).values({
    id,
    subjectType: "entry",
    subjectId,
    source: "reports",
    status,
    resolvedAt,
    createdAt: LINE - 400 * DAY,
  });
  return id;
}

async function anAction(createdAt: number): Promise<string> {
  const id = newUlid();
  await db.insert(moderationActions).values({
    id,
    actorId: newUlid(),
    action: "takedown",
    subjectType: "photo",
    subjectId: newUlid(),
    subjectOwnerId: newUlid(),
    reason: "copyright",
    createdAt,
  });
  return id;
}

async function aHold(
  status: "hidden" | "restored" | "purging" | "purged",
  settledAt: number | undefined,
  extra: Partial<typeof copyrightHolds.$inferInsert> = {},
): Promise<{ id: string; actionId: string }> {
  const id = newUlid();
  const actionId = await anAction(LINE - 500 * DAY);
  await db.insert(copyrightHolds).values({
    id,
    moderationActionId: actionId,
    subjectType: "photo",
    subjectId: newUlid(),
    ownerId: newUlid(),
    entryId: newUlid(),
    status,
    hiddenAt: LINE - 500 * DAY,
    purgeAt: LINE - 470 * DAY,
    settledAt,
    ...extra,
  });
  return { id, actionId };
}

describe("MODERATION_RECORD_KEPT_SECONDS", () => {
  it("is three years of 365 days and one leap day, in seconds", () => {
    expect(MODERATION_RECORD_KEPT_SECONDS).toBe(1096 * 86_400);
  });
});

describe("takedown requests", () => {
  it("go a second past 3 years after the decision, and stay on the line", async () => {
    const past = await aRequest(LINE - 1);
    const onLine = await aRequest(LINE, "declined");
    const pending = await aRequest(undefined, "pending");

    await sweepModerationRecords(db, NOW);

    expect(await kept.requests()).toStrictEqual(sorted(onLine, pending));
    expect(await kept.requests()).not.toContain(past);
  });
});

describe("reports", () => {
  it("with no decision go a second past 3 years after filing, and stay on the line", async () => {
    const past = await aReport(newUlid(), LINE - 1);
    const onLine = await aReport(newUlid(), LINE);

    await sweepModerationRecords(db, NOW);

    expect(await kept.reports()).toStrictEqual([onLine]);
    expect(await kept.reports()).not.toContain(past);
  });

  it("run from their subject's decision when it is later than the filing", async () => {
    const decidedOnLine = newUlid();
    const decidedPast = newUlid();
    const onLine = await aReport(decidedOnLine, LINE - 100 * DAY);
    await aReview(decidedOnLine, LINE, "removed");
    const past = await aReport(decidedPast, LINE - 100 * DAY);
    await aReview(decidedPast, LINE - 1);

    await sweepModerationRecords(db, NOW);

    expect(await kept.reports()).toStrictEqual([onLine]);
    expect(await kept.reports()).not.toContain(past);
  });

  it("stay while their subject's review is open, however old", async () => {
    const pending = newUlid();
    const reviewing = newUlid();
    const waiting = await aReport(pending, LINE - 900 * DAY);
    const claimed = await aReport(reviewing, LINE - 900 * DAY);
    await aReview(pending, undefined, "pending");
    await aReview(reviewing, undefined, "reviewing");

    await sweepModerationRecords(db, NOW);

    expect(await kept.reports()).toStrictEqual(sorted(waiting, claimed));
  });

  it("are not kept by a review of a different subject", async () => {
    const report = await aReport(newUlid(), LINE - 1);
    await aReview(newUlid(), undefined, "pending");

    await sweepModerationRecords(db, NOW);

    expect(await kept.reports()).not.toContain(report);
  });
});

describe("review rows", () => {
  it("go a second past 3 years after the decision, and stay on the line", async () => {
    const past = await aReview(newUlid(), LINE - 1);
    const onLine = await aReview(newUlid(), LINE, "removed");
    const open = await aReview(newUlid(), undefined, "pending");

    await sweepModerationRecords(db, NOW);

    expect(await kept.reviews()).toStrictEqual(sorted(onLine, open));
    expect(await kept.reviews()).not.toContain(past);
  });

  it("stay while a report is left on their subject, and go with the last one", async () => {
    const reportedSince = newUlid();
    const reportedBefore = newUlid();
    const stays = await aReview(reportedSince, LINE - 1);
    const recent = await aReport(reportedSince, LINE);
    const goes = await aReview(reportedBefore, LINE - 1);
    const old = await aReport(reportedBefore, LINE - 10 * DAY);

    await sweepModerationRecords(db, NOW);

    expect(await kept.reviews()).toStrictEqual([stays]);
    expect(await kept.reports()).toStrictEqual([recent]);
    expect(await kept.reviews()).not.toContain(goes);
    expect(await kept.reports()).not.toContain(old);
  });
});

describe("copyright holds", () => {
  it("restored or purged, go a second past 3 years after settling, and stay on the line", async () => {
    const restored = await aHold("restored", LINE - 1);
    const purged = await aHold("purged", LINE - 1);
    const onLine = await aHold("purged", LINE);

    await sweepModerationRecords(db, NOW);

    expect(await kept.holds()).toStrictEqual([onLine.id]);
    expect(await kept.holds()).not.toContain(restored.id);
    expect(await kept.holds()).not.toContain(purged.id);
  });

  it("are never swept while live: hidden, held for a court case, or purging", async () => {
    const hidden = await aHold("hidden", undefined);
    const awaitingRestore = await aHold("hidden", undefined, {
      counterNoticeAt: LINE - 480 * DAY,
      restoreAt: LINE - 460 * DAY,
    });
    const litigation = await aHold("hidden", undefined, {
      counterNoticeAt: LINE - 480 * DAY,
      courtActionAt: LINE - 470 * DAY,
    });
    // `purging` stamps its lease in `settled_at`; it is not a decision.
    const purging = await aHold("purging", LINE - 1);

    await sweepModerationRecords(db, NOW);

    const live = [hidden, awaitingRestore, litigation, purging];
    expect(await kept.holds()).toStrictEqual(sorted(...live.map((h) => h.id)));
    // And the audit rows they read stay with them.
    expect(await kept.actions()).toStrictEqual(
      sorted(...live.map((h) => h.actionId)),
    );
  });
});

describe("moderation actions", () => {
  it("go a second past 3 years after they were taken, and stay on the line", async () => {
    const past = await anAction(LINE - 1);
    const onLine = await anAction(LINE);

    await sweepModerationRecords(db, NOW);

    expect(await kept.actions()).toStrictEqual([onLine]);
    expect(await kept.actions()).not.toContain(past);
  });

  it("stay while their hold does, and go in the same pass as it", async () => {
    const settling = await aHold("purged", LINE);
    const settled = await aHold("restored", LINE - 1);

    await sweepModerationRecords(db, NOW);

    expect(await kept.actions()).toStrictEqual([settling.actionId]);
    expect(await kept.actions()).not.toContain(settled.actionId);
  });

  it("stay while a quarantine record names them", async () => {
    const quarantined = await anAction(LINE - 900 * DAY);
    await db.insert(quarantinedContent).values({
      id: newUlid(),
      moderationActionId: quarantined,
      subjectType: "entry",
      subjectId: newUlid(),
      uploaderId: newUlid(),
      entryId: newUlid(),
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt: LINE - 900 * DAY,
      retainUntil: NOW + DAY,
    });

    await sweepModerationRecords(db, NOW);

    expect(await kept.actions()).toStrictEqual([quarantined]);
  });
});

describe("the sweep is re-runnable (law 1)", () => {
  it("changes nothing on a second pass", async () => {
    await aRequest(LINE - DAY);
    const request = await aRequest(LINE);
    await aReport(newUlid(), LINE - DAY);
    const report = await aReport(newUlid(), LINE);
    const hold = await aHold("hidden", undefined);
    await aHold("purged", LINE - DAY);
    const action = await anAction(LINE);

    await sweepModerationRecords(db, NOW);
    const afterFirst = {
      requests: await kept.requests(),
      reports: await kept.reports(),
      holds: await kept.holds(),
      actions: await kept.actions(),
    };
    await sweepModerationRecords(db, NOW);

    expect(afterFirst).toStrictEqual({
      requests: [request],
      reports: [report],
      holds: [hold.id],
      actions: sorted(hold.actionId, action),
    });
    expect({
      requests: await kept.requests(),
      reports: await kept.reports(),
      holds: await kept.holds(),
      actions: await kept.actions(),
    }).toStrictEqual(afterFirst);
  });
});

describe("the production call", () => {
  it("measures from the present on the core database", async () => {
    const now = nowSeconds();
    const past = await anAction(now - MODERATION_RECORD_KEPT_SECONDS - 60);
    const recent = await anAction(now - MODERATION_RECORD_KEPT_SECONDS + 600);

    await sweepModerationRecords();

    const left = await db
      .select({ id: moderationActions.id })
      .from(moderationActions)
      .where(inArray(moderationActions.id, [past, recent]));
    expect(left).toStrictEqual([{ id: recent }]);
  });
});

async function planOf(sql: string, params: unknown[]): Promise<string> {
  const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail).join("\n");
}

describe("the sweep reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds each table's rows through its index", async () => {
    const plans = await Promise.all(
      moderationRecordDeletes(db, LINE).map((statement) => {
        const { sql, params } = statement.toSQL();
        return planOf(sql, params);
      }),
    );

    expect(plans).toHaveLength(5);
    const expected = [
      /takedown_requests_resolved/u,
      /reports_created[\s\S]*review_queue_subject/u,
      /review_queue_resolved[\s\S]*reports_subject/u,
      /copyright_holds_status_settled/u,
      /moderation_actions_created[\s\S]*copyright_holds_action[\s\S]*quarantined_content_action/u,
    ];
    for (const [index, plan] of plans.entries()) {
      expect(plan).toMatch(expected[index] ?? /never/u);
      expect(plan).not.toMatch(/\bSCAN\b/u);
    }
  });
});
