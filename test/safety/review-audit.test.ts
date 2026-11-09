import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { reviewAudit } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  fileReport,
  moderationThresholds,
  pendingReviewQueue,
  reportersToHide,
} from "../../src/modules/safety";
import { reportersFor } from "../../src/modules/safety/review-audit";
import { noPurge } from "../purge-spy";
import { oweInCore } from "../queue-fakes";
import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await core().delete(reviewAudit);
  await resetSafetyTables();
});

const enough = reportersToHide("spam", moderationThresholds());

const HANDLES = ["ada", "bo", "cy", "dee", "eve"].slice(0, Math.max(enough, 2));

/**
 * An entry reported up to the threshold by named runners, and its row.
 */
async function reported(): Promise<{ entryId: string; queueId: string }> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({
    userId: author,
    runId,
    audience: "runners",
  });
  for (const handle of HANDLES) {
    await fileReport(
      {
        reporterId: await makeUser({ username: handle }),
        subjectType: "entry",
        subjectId: entryId,
        reason: handle === "bo" ? "harassment" : "spam",
      },
      oweInCore,
      noPurge,
    );
  }
  // One second apart, in filing order. Filed within one second, the
  // reports tie on `created_at` and fall back to their ULIDs, which are not
  // monotonic within a millisecond, so "oldest first" would be a coin toss.
  await core().run(
    sql.raw("update reports set created_at = created_at + rowid"),
  );
  const [queued] = await pendingReviewQueue();
  if (queued === undefined) throw new Error("nothing queued");
  return { entryId, queueId: queued.id };
}

describe("opening WHO REPORTED (D-164, R-66)", () => {
  it("answers each reporter, oldest first, with what they picked", async () => {
    const { queueId } = await reported();
    const reporters = await reportersFor("01OPERATOR", queueId);
    expect(reporters.map((reporter) => reporter.handle)).toStrictEqual(HANDLES);
    expect(reporters[1]?.reason).toBe("harassment");
    expect(reporters[0]?.createdAt).toBeTypeOf("number");
  });

  it("records the look: who, which row and which subject", async () => {
    const { entryId, queueId } = await reported();
    await reportersFor("01OPERATOR", queueId);
    const rows = await core().select().from(reviewAudit);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: "01OPERATOR",
      action: "opened_reporters",
      reviewId: queueId,
      subjectType: "entry",
      subjectId: entryId,
    });
    expect(rows[0]?.createdAt).toBeTypeOf("number");
    expect(rows[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it("records every look, each its own row", async () => {
    const { queueId } = await reported();
    await reportersFor("01OPERATOR", queueId);
    await reportersFor("01OTHER", queueId);
    const looks = await core().select().from(reviewAudit);
    const actors = looks.map((row) => row.actorId);
    expect(
      actors.toSorted((left, right) => left.localeCompare(right)),
    ).toStrictEqual(["01OPERATOR", "01OTHER"]);
  });

  it("answers no one and records nothing for a row that does not exist", async () => {
    expect(await reportersFor("01OPERATOR", newUlid())).toStrictEqual([]);
    expect(await core().select().from(reviewAudit)).toHaveLength(0);
  });

  it("names nobody for a closed account", async () => {
    const { queueId } = await reported();
    // A purge renames the reporter, so they still count but name nobody.
    await core().run(
      sql.raw(
        "update reports set reporter_id = 'deleted:' || id where rowid = (select min(rowid) from reports)",
      ),
    );
    const [first] = await reportersFor("01OPERATOR", queueId);
    expect(first?.handle).toBeNull();
  });
});
