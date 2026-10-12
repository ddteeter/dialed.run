import { and, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { accessRequests } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { forgetAnsweredRequests } from "../../src/modules/account/answered-requests";

/**
 * The daily sweep of the waitlist: a request answered (invited or
 * declined) more than 90 days ago is deleted; an unanswered one stays
 * however old it is.
 */

const db = drizzle(env.DIALED_CORE);
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

type Status = "pending" | "invited" | "declined";

/**
A request in `status`, last written (answered) at `answeredAt`.
*/
async function aRequest(status: Status, answeredAt: number): Promise<string> {
  const id = newUlid();
  await db.insert(accessRequests).values({
    id,
    email: `${id}@example.test`,
    status,
    createdAt: answeredAt - DAY,
    updatedAt: answeredAt,
  });
  return id;
}

async function isKept(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(eq(accessRequests.id, id));
  return rows.length === 1;
}

describe("forgetAnsweredRequests", () => {
  it.each(["invited", "declined"] as const)(
    "deletes a request %s more than 90 days ago, and keeps the rest",
    async (status) => {
      const long = await aRequest(status, NOW - 90 * DAY - 1);
      const edge = await aRequest(status, NOW - 90 * DAY);
      const recent = await aRequest(status, NOW - DAY);

      await forgetAnsweredRequests(db, NOW);

      expect(await isKept(long)).toBe(false);
      // Exactly 90 days is not more than 90 days.
      expect(await isKept(edge)).toBe(true);
      expect(await isKept(recent)).toBe(true);
    },
  );

  it("keeps an unanswered request however old", async () => {
    const waiting = await aRequest("pending", NOW - 400 * DAY);

    await forgetAnsweredRequests(db, NOW);

    expect(await isKept(waiting)).toBe(true);
  });

  it("is re-runnable: a second pass changes nothing", async () => {
    const long = await aRequest("invited", NOW - 200 * DAY);
    const waiting = await aRequest("pending", NOW - 200 * DAY);

    await forgetAnsweredRequests(db, NOW);
    await forgetAnsweredRequests(db, NOW);

    expect(await isKept(long)).toBe(false);
    expect(await isKept(waiting)).toBe(true);
  });

  it("measures from the present when no time is given (the production call)", async () => {
    const now = nowSeconds();
    const long = await aRequest("declined", now - 91 * DAY);
    const recent = await aRequest("declined", now - 89 * DAY);

    await forgetAnsweredRequests();

    expect(await isKept(long)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  });
});

describe("the sweep reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds answered requests through access_requests_status_updated", async () => {
    const query = db
      .delete(accessRequests)
      .where(
        and(
          inArray(accessRequests.status, ["invited", "declined"]),
          lt(accessRequests.updatedAt, NOW),
        ),
      )
      .toSQL();

    const plan = await env.DIALED_CORE.prepare(
      `EXPLAIN QUERY PLAN ${query.sql}`,
    )
      .bind(...query.params)
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");

    expect(detail).toMatch(/access_requests_status_updated/u);
    expect(detail).not.toMatch(/SCAN\s+access_requests\b/iu);
  });
});
