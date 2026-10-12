import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entryPhotos, moderationActions } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { moderateContent } from "../../src/modules/feed/moderation";
import { removalsOnRun } from "../../src/modules/safety";
import { runRemovalsQuery } from "../../src/modules/safety/run-removals";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * R-140: the band where the thing was. A Remove deletes, so the run finds
 * what came off it through the audit row's `run_id`, read before the
 * delete.
 */
function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // The fast path's failures are not under test here.
}

const NOW = 1_800_000_000;

async function runWithPhoto(userId: string) {
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId });
  const photoId = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId,
      photoKey: `entries/${userId}/${entryId}/${photoId}`,
      position: 0,
      screenStatus: "pass",
    });
  return { runId, entryId, photoId };
}

async function audit(row: {
  ownerId: string;
  runId: string | undefined;
  action?: "remove" | "takedown" | "quarantine";
  subjectType?: "entry" | "photo" | "profile";
  reason?: string;
  createdAt?: number;
}) {
  const id = newUlid();
  await core()
    .insert(moderationActions)
    .values({
      id,
      actorId: "desk",
      action: row.action ?? "remove",
      subjectType: row.subjectType ?? "photo",
      subjectId: newUlid(),
      subjectOwnerId: row.ownerId,
      reason: row.reason ?? "it's an ad or spam",
      createdAt: row.createdAt ?? NOW,
      runId: row.runId,
    });
  return id;
}

beforeEach(async () => {
  await resetSafetyTables();
  vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("moderateContent keeps the run", () => {
  it("records the photo's run on a Remove, and the entry's on a takedown", async () => {
    const author = await makeUser();
    const first = await runWithPhoto(author);
    const second = await runWithPhoto(author);

    await moderateContent(
      core(),
      {
        actorId: "desk",
        action: "remove",
        subjectType: "photo",
        subjectId: first.photoId,
        reason: "home",
      },
      quiet,
    );
    await moderateContent(
      core(),
      {
        actorId: "desk",
        action: "takedown",
        subjectType: "entry",
        subjectId: second.entryId,
        reason: "copyright",
        notice: "Acme Photo Co, ref 2026-114",
      },
      quiet,
    );

    const rows = await core()
      .select({
        subjectId: moderationActions.subjectId,
        runId: moderationActions.runId,
      })
      .from(moderationActions);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      subjectId: first.photoId,
      runId: first.runId,
    });
    expect(rows).toContainEqual({
      subjectId: second.entryId,
      runId: second.runId,
    });

    // And each run reads its own back, with the reason its band states.
    expect(await removalsOnRun(core(), author, first.runId)).toMatchObject([
      { subjectType: "photo", action: "remove", reason: "home" },
    ]);
    expect(await removalsOnRun(core(), author, second.runId)).toMatchObject([
      { subjectType: "entry", action: "takedown", reason: "copyright" },
    ]);
  });
});

describe("removalsOnRun", () => {
  it("lists a run's removals, newest first, with each one's id", async () => {
    const author = await makeUser();
    const runId = newUlid();
    const older = await audit({ ownerId: author, runId, createdAt: NOW });
    const newer = await audit({
      ownerId: author,
      runId,
      subjectType: "entry",
      reason: "it shows where someone lives",
      createdAt: NOW + 1,
    });

    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([
      { id: newer, subjectType: "entry", action: "remove", reason: "home" },
      { id: older, subjectType: "photo", action: "remove", reason: "spam" },
    ]);
  });

  it("reads a takedown's reason through the notice it carries", async () => {
    const author = await makeUser();
    const runId = newUlid();
    await audit({
      ownerId: author,
      runId,
      action: "takedown",
      reason: "it uses someone else's work — Acme Photo Co, ref 2026-114",
    });

    expect(await removalsOnRun(core(), author, runId)).toMatchObject([
      { action: "takedown", reason: "copyright" },
    ]);
  });

  it("answers only the run's author, and only for that run", async () => {
    const author = await makeUser();
    const runId = newUlid();
    await audit({ ownerId: author, runId });
    await audit({ ownerId: author, runId: newUlid() });

    expect(await removalsOnRun(core(), await makeUser(), runId)).toStrictEqual(
      [],
    );
    expect(await removalsOnRun(core(), author, runId)).toHaveLength(1);
  });

  it("leaves out a quarantine, which tells nobody, and anything about a profile", async () => {
    const author = await makeUser();
    const runId = newUlid();
    await audit({ ownerId: author, runId, action: "quarantine" });
    await audit({ ownerId: author, runId, subjectType: "profile" });

    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([]);
  });

  it("leaves out words that are no reason this build knows", async () => {
    const author = await makeUser();
    const runId = newUlid();
    await audit({ ownerId: author, runId, reason: "made up" });
    await audit({ ownerId: author, runId, reason: "it's an ad or spam!" });

    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([]);
  });

  it("keeps working with audit rows written before run_id existed", async () => {
    const author = await makeUser();
    const { runId } = await runWithPhoto(author);
    // An old row: no run, so it is found by no run and breaks nothing.
    const old = await audit({ ownerId: author, runId: undefined });

    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([]);
    const [kept] = await core()
      .select({ runId: moderationActions.runId })
      .from(moderationActions)
      .where(eq(moderationActions.id, old));
    expect(kept?.runId).toBeNull();
  });
});

describe("the read's cost", () => {
  it("is keyed by moderation_actions_run, never a scan", async () => {
    const { sql, params } = runRemovalsQuery(
      core(),
      newUlid(),
      newUlid(),
    ).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toMatch(
      /moderation_actions USING INDEX moderation_actions_run/,
    );
    expect(details).not.toMatch(/SCAN\s+moderation_actions/i);
  });
});
