import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { countRow, countedKeys } from "../rate-limit-rows";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { SIGN_IN_WINDOW_S } from "../../src/lib/contracts/access";
import type { RateLimitKind } from "../../src/lib/contracts/rate-limits";
import {
  claimEmailSend,
  RATE_LIMIT_SWEEP_BATCH,
  RATE_LIMIT_SWEEP_PASSES,
  rateLimitSweepRules,
  SEND_WINDOW_S,
  SENDS_PER_WINDOW,
  SHORT_KEPT_S,
} from "../../src/modules/email/rate-limit";
import { queriesDuring } from "../d1-spy";
import { sweepRateLimits } from "../../src/modules/email";

/**
 * The daily sweep of rate-limit counts (per address, and per visitor IP
 * for request access and `/takedown`): a count goes a day after its hour
 * ends, and nothing it held changes a verdict.
 */

const db = drizzle(env.DIALED_CORE);
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

/**
A count whose window started at `startedAt`, for a subject of its own.
*/
async function aCount(startedAt: number): Promise<string> {
  const subject = newUlid();
  await db
    .insert(rateLimits)
    .values(countRow("access", subject, SENDS_PER_WINDOW + 3, startedAt));
  return `access:${subject}`;
}

/**
A count of `kind` whose window started at `startedAt`.
*/
async function aCountOf(
  kind: RateLimitKind,
  startedAt: number,
): Promise<string> {
  const subject = newUlid();
  await db.insert(rateLimits).values(countRow(kind, subject, 1, startedAt));
  return `${kind}:${subject}`;
}

/**
The delete statements a sweep sent.
*/
function deletesIn(statements: readonly string[]): string[] {
  return statements.filter((statement) => /^delete from/iu.test(statement));
}

async function isKept(key: string): Promise<boolean> {
  const keys = await countedKeys(db);
  return keys.includes(key);
}

describe("sweepRateLimits", () => {
  it("deletes a count a day past its window, and keeps the rest", async () => {
    const windowEnded = NOW - SEND_WINDOW_S;
    const long = await aCount(windowEnded - DAY - 1);
    const edge = await aCount(windowEnded - DAY);
    const current = await aCount(NOW - 60);

    await sweepRateLimits(db, NOW);

    expect(await isKept(long)).toBe(false);
    // A day exactly is not more than a day.
    expect(await isKept(edge)).toBe(true);
    expect(await isKept(current)).toBe(true);
  });

  it("is re-runnable: a second pass changes nothing", async () => {
    const long = await aCount(NOW - 3 * DAY);
    const current = await aCount(NOW);

    await sweepRateLimits(db, NOW);
    await sweepRateLimits(db, NOW);

    expect(await isKept(long)).toBe(false);
    expect(await isKept(current)).toBe(true);
  });

  it("measures from the present when no time is given (the production call)", async () => {
    const now = nowSeconds();
    const long = await aCount(now - 2 * DAY);
    const recent = await aCount(now - DAY);

    await sweepRateLimits(db);

    expect(await isKept(long)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  });

  it("changes no verdict: a swept address starts over as an ended window would", async () => {
    // Over the limit in a window that ended long ago: the upsert would
    // have started it over at one, and with the row gone it starts at one.
    const address = `${newUlid()}@example.test`;
    await db
      .insert(rateLimits)
      .values(countRow("verify", address, SENDS_PER_WINDOW + 3, NOW - 3 * DAY));

    await sweepRateLimits(db, NOW);

    expect(await isKept(`verify:${address}`)).toBe(false);
    expect(await claimEmailSend(db, "verify", address, NOW)).toStrictEqual({
      isAllowed: true,
    });
  });
});

describe("the sweep reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds ended windows through rate_limits_window", async () => {
    const query = db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStartedAt, NOW))
      .toSQL();

    const plan = await env.DIALED_CORE.prepare(
      `EXPLAIN QUERY PLAN ${query.sql}`,
    )
      .bind(...query.params)
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");

    expect(detail).toMatch(/rate_limits_window/u);
    expect(detail).not.toMatch(/SCAN\s+rate_limits\b/iu);
  });
});

describe("the sweep works a large table down in batches", () => {
  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("deletes by rowid a batch at a time, until a pass finds fewer", async () => {
    const old = await Promise.all(
      [1, 2, 3, 4, 5].map(() => aCount(NOW - 3 * DAY)),
    );
    const fresh = await aCount(NOW);

    const tally = await queriesDuring(() => sweepRateLimits(db, NOW, 2));

    const deletes = deletesIn(tally.statements);
    // Three passes of two (2, 2, 1), then one each for the other rules.
    expect(deletes).toHaveLength(3 + rateLimitSweepRules(NOW).length - 1);
    for (const statement of deletes) {
      expect(statement).toMatch(/\browid\b/iu);
      expect(statement).toMatch(/\blimit\b/iu);
    }
    for (const key of old) expect(await isKept(key)).toBe(false);
    expect(await isKept(fresh)).toBe(true);
  });

  it("stops after its passes, and the next firing finishes the work", async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => aCount(NOW - 3 * DAY)));

    const first = await queriesDuring(() => sweepRateLimits(db, NOW, 2, 2));
    expect(deletesIn(first.statements)).toHaveLength(2);
    expect(await countedKeys(db)).toHaveLength(1);

    await sweepRateLimits(db, NOW, 2, 2);
    expect(await countedKeys(db)).toStrictEqual([]);
  });

  it("counts a pass that deletes nothing as the last", async () => {
    const tally = await queriesDuring(() => sweepRateLimits(db, NOW, 2));
    expect(deletesIn(tally.statements)).toHaveLength(
      rateLimitSweepRules(NOW).length,
    );
  });

  it("shares its passes across every rule, so one call is bounded", async () => {
    // Two passes delete these, and a third finds none.
    await Promise.all([1, 2].map(() => aCount(NOW - 3 * DAY)));
    await Promise.all(
      [1, 2, 3].map(() => aCountOf("sign-in", NOW - 3 * SIGN_IN_WINDOW_S)),
    );

    const tally = await queriesDuring(() => sweepRateLimits(db, NOW, 1, 4));

    expect(deletesIn(tally.statements)).toHaveLength(4);
    expect(await countedKeys(db)).toHaveLength(2);
  });

  it("works in batches of ten thousand, a hundred a call, by default", async () => {
    expect(RATE_LIMIT_SWEEP_BATCH).toBe(10_000);
    expect(RATE_LIMIT_SWEEP_PASSES).toBe(100);
    const old = await aCount(NOW - 3 * DAY);
    await sweepRateLimits(db, NOW);
    expect(await isKept(old)).toBe(false);
  });
});

describe("sign-in's and Resend's counts go soon after their window", () => {
  it("deletes a sign-in count once its window and the margin are past", async () => {
    const cutoff = NOW - SIGN_IN_WINDOW_S - SHORT_KEPT_S;
    const past = await aCountOf("sign-in", cutoff - 1);
    const edge = await aCountOf("sign-in", cutoff);

    await sweepRateLimits(db, NOW);

    expect(SHORT_KEPT_S).toBe(15 * 60);
    expect(await isKept(past)).toBe(false);
    expect(await isKept(edge)).toBe(true);
  });

  it("deletes a verify count once its hour and the margin are past", async () => {
    const cutoff = NOW - SEND_WINDOW_S - SHORT_KEPT_S;
    const past = await aCountOf("verify", cutoff - 1);
    const edge = await aCountOf("verify", cutoff);

    await sweepRateLimits(db, NOW);

    expect(await isKept(past)).toBe(false);
    expect(await isKept(edge)).toBe(true);
  });

  it("keeps every other kind a day past its hour, a day's count included", async () => {
    const twoHours = NOW - 2 * SEND_WINDOW_S;
    const kept = await Promise.all(
      (
        ["reset", "change", "photo-runner", "weather-runner", "access"] as const
      ).map((kind) => aCountOf(kind, twoHours)),
    );

    await sweepRateLimits(db, NOW);

    for (const key of kept) expect(await isKept(key)).toBe(true);
  });

  it("changes no sign-in verdict: a swept address starts over at one try", async () => {
    const address = `${newUlid()}@example.test`;
    await db
      .insert(rateLimits)
      .values(
        countRow(
          "sign-in",
          address,
          99,
          NOW - SIGN_IN_WINDOW_S - SHORT_KEPT_S - 1,
        ),
      );

    await sweepRateLimits(db, NOW);

    expect(await isKept(`sign-in:${address}`)).toBe(false);
  });
});

describe("each sweep rule reads by index, not by scanning", () => {
  it("plans every rule's batch read without a scan of rate_limits", async () => {
    for (const rule of rateLimitSweepRules(NOW)) {
      const query = db
        .select({ rowid: sql`rowid` })
        .from(rateLimits)
        .where(rule)
        .limit(10)
        .toSQL();
      const plan = await env.DIALED_CORE.prepare(
        `EXPLAIN QUERY PLAN ${query.sql}`,
      )
        .bind(...query.params)
        .all<{ detail: string }>();
      const detail = plan.results.map((row) => row.detail).join("\n");
      expect(detail).toMatch(/SEARCH/u);
      expect(detail).not.toMatch(/SCAN\s+rate_limits\b/iu);
    }
  });
});
