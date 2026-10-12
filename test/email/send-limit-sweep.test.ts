import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { emailSendLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  claimEmailSend,
  SEND_WINDOW_S,
  SENDS_PER_WINDOW,
} from "../../src/modules/email/send-limit";
import { sweepSendLimits } from "../../src/modules/email";

/**
 * The daily sweep of send-limit counts (per address, and per visitor IP
 * for request access and `/takedown`): a count goes a day after its hour
 * ends, and nothing it held changes a verdict.
 */

const db = drizzle(env.DIALED_CORE);
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

/**
A count whose window started at `startedAt`, under a key of its own.
*/
async function aCount(startedAt: number): Promise<string> {
  const key = `access:${newUlid()}`;
  await db
    .insert(emailSendLimits)
    .values({ key, windowStartedAt: startedAt, sends: SENDS_PER_WINDOW + 3 });
  return key;
}

async function isKept(key: string): Promise<boolean> {
  const rows = await db
    .select({ key: emailSendLimits.key })
    .from(emailSendLimits)
    .where(eq(emailSendLimits.key, key));
  return rows.length === 1;
}

describe("sweepSendLimits", () => {
  it("deletes a count a day past its window, and keeps the rest", async () => {
    const windowEnded = NOW - SEND_WINDOW_S;
    const long = await aCount(windowEnded - DAY - 1);
    const edge = await aCount(windowEnded - DAY);
    const current = await aCount(NOW - 60);

    await sweepSendLimits(db, NOW);

    expect(await isKept(long)).toBe(false);
    // A day exactly is not more than a day.
    expect(await isKept(edge)).toBe(true);
    expect(await isKept(current)).toBe(true);
  });

  it("is re-runnable: a second pass changes nothing", async () => {
    const long = await aCount(NOW - 3 * DAY);
    const current = await aCount(NOW);

    await sweepSendLimits(db, NOW);
    await sweepSendLimits(db, NOW);

    expect(await isKept(long)).toBe(false);
    expect(await isKept(current)).toBe(true);
  });

  it("measures from the present when no time is given (the production call)", async () => {
    const now = nowSeconds();
    const long = await aCount(now - 2 * DAY);
    const recent = await aCount(now - DAY);

    await sweepSendLimits(db);

    expect(await isKept(long)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  });

  it("changes no verdict: a swept address starts over as an ended window would", async () => {
    // Over the limit in a window that ended long ago: the upsert would
    // have started it over at one, and with the row gone it starts at one.
    const address = `${newUlid()}@example.test`;
    await db.insert(emailSendLimits).values({
      key: `verify:${address}`,
      windowStartedAt: NOW - 3 * DAY,
      sends: SENDS_PER_WINDOW + 3,
    });

    await sweepSendLimits(db, NOW);

    expect(await isKept(`verify:${address}`)).toBe(false);
    expect(await claimEmailSend(db, "verify", address, NOW)).toStrictEqual({
      isAllowed: true,
    });
  });
});

describe("the sweep reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds ended windows through email_send_limits_window", async () => {
    const query = db
      .delete(emailSendLimits)
      .where(lt(emailSendLimits.windowStartedAt, NOW))
      .toSQL();

    const plan = await env.DIALED_CORE.prepare(
      `EXPLAIN QUERY PLAN ${query.sql}`,
    )
      .bind(...query.params)
      .all<{ detail: string }>();
    const detail = plan.results.map((row) => row.detail).join("\n");

    expect(detail).toMatch(/email_send_limits_window/u);
    expect(detail).not.toMatch(/SCAN\s+email_send_limits\b/iu);
  });
});
