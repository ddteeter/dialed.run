import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { cronCheckpoints, outbox } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { dayLabel } from "../../src/lib/dates";
import { nowSeconds } from "../../src/lib/now";
import { handleScheduled } from "../../src/modules/ops";
import type { TodayCounts } from "../../src/modules/ops/desk";
import {
  digestTemplate,
  oweDigestEmail,
  type DigestMail,
} from "../../src/modules/ops/digest-email";
import type { OutboxDebt } from "../../src/modules/ops/outbox";
import { fakeMail, owedTo, seedUser } from "../email/helpers";

/**
 * The morning digest by email (task 125 · OPS-11; Operator Screens D5):
 * Today's three numbers to every operator, every day, even at zero.
 */
const db = drizzle(env.DIALED_CORE);
const DIGEST = { cron: "0 12 * * *" } as ScheduledController;
const HOUR = 3600;

const COUNTS: TodayCounts = {
  waiting: 4,
  oldestWaitingAt: 1_000_000,
  screenerUnfinished: 1,
  bansThisWeek: 0,
  bansAllTime: 3,
  gaveUp: 2,
  oldestGaveUpAt: 900_000,
};

beforeEach(async () => {
  await db.delete(outbox);
  await db.delete(cronCheckpoints);
});

describe("digestTemplate", () => {
  it("carries Today's numbers, the oldest wait in whole hours", () => {
    const now = 1_000_000 + 19 * HOUR + HOUR - 1;
    expect(digestTemplate(COUNTS, now)).toStrictEqual({
      kind: "digest",
      day: dayLabel(now),
      waiting: 4,
      oldestHours: 19,
      screenerUnfinished: 1,
      bansThisWeek: 0,
      gaveUp: 2,
    });
  });

  it("has no oldest wait when nothing is waiting", () => {
    expect(
      digestTemplate(
        { ...COUNTS, waiting: 0, oldestWaitingAt: undefined },
        1_000_000,
      ).oldestHours,
    ).toBeUndefined();
  });
});

/**
A digest's operators and counts, and every debt it settled.
*/
function digestMail(
  admins: readonly string[],
  settle: DigestMail["settle"],
  counts: TodayCounts = COUNTS,
): DigestMail {
  return {
    admins: () => admins,
    counts: () => Promise.resolve(counts),
    settle,
  };
}

async function owedDigests() {
  const rows = await db
    .select({ dedupeKey: outbox.dedupeKey })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows
    .map((row) => row.dedupeKey)
    .toSorted((a, b) => a.localeCompare(b));
}

describe("oweDigestEmail", () => {
  it("owes each operator the morning's digest, keyed by day and operator, and sends it now", async () => {
    const settled: OutboxDebt[] = [];
    const now = nowSeconds();
    await oweDigestEmail(
      db,
      digestMail(["op-a", "op-b"], (_db, debt) => {
        settled.push(debt);
        return Promise.resolve();
      }),
      now,
    );
    const day = dayLabel(now);
    expect(await owedDigests()).toStrictEqual([
      `digest:${day}:op-a`,
      `digest:${day}:op-b`,
    ]);
    expect(settled.map((debt) => debt.message)).toStrictEqual(
      ["op-a", "op-b"].map((userId) => ({
        kind: "email",
        payload: {
          dedupeKey: `digest:${day}:${userId}`,
          email: { to: { userId }, template: digestTemplate(COUNTS, now) },
        },
      })),
    );
  });

  it("is one email per operator however often the firing runs", async () => {
    const mail = digestMail(["op-a"], () => Promise.resolve());
    const now = nowSeconds();
    await oweDigestEmail(db, mail, now);
    await oweDigestEmail(db, mail, now);
    expect(await owedDigests()).toHaveLength(1);
  });

  it("owes nothing more the same UTC day once the first digest was sent and its row settled", async () => {
    const DAY = 86_400;
    const midnight = 20_000 * DAY;
    let sends = 0;
    // The live fast path's effect: sent, then the row deleted.
    const mail = digestMail(["op-a"], async (_db, debt) => {
      sends += 1;
      await db.delete(outbox).where(eq(outbox.id, debt.id));
    });

    await oweDigestEmail(db, mail, midnight);
    expect(sends).toBe(1);
    expect(await owedDigests()).toStrictEqual([]);

    // Re-fired later that day, and at its last second: nothing.
    await oweDigestEmail(db, mail, midnight + 3 * 3600);
    await oweDigestEmail(db, mail, midnight + DAY - 1);
    expect(sends).toBe(1);

    // The next day is owed again, and marked again: once that day too.
    await oweDigestEmail(db, mail, midnight + DAY);
    await oweDigestEmail(db, mail, midnight + DAY + 60);
    expect(sends).toBe(2);
    // The mark is its own row, beside the firing's heartbeat.
    const marks = await db
      .select()
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "digest-email"));
    expect(marks).toStrictEqual([
      { cronName: "digest-email", lastRunAt: midnight + DAY },
    ]);
  });

  it("owes a day whose last mark was the second before it began", async () => {
    const midnight = 20_000 * 86_400;
    let sends = 0;
    const mail = digestMail(["op-a"], () => {
      sends += 1;
      return Promise.resolve();
    });
    await oweDigestEmail(db, mail, midnight - 1);
    await db.delete(outbox);
    await oweDigestEmail(db, mail, midnight);
    expect(sends).toBe(2);
  });

  it("marks nothing when no operator is configured, so one added later that day is mailed", async () => {
    const midnight = 20_000 * 86_400;
    await oweDigestEmail(
      db,
      digestMail([], () => Promise.resolve()),
      midnight,
    );
    let sends = 0;
    await oweDigestEmail(
      db,
      digestMail(["op-a"], () => {
        sends += 1;
        return Promise.resolve();
      }),
      midnight + 60,
    );
    expect(sends).toBe(1);
  });

  it("owes nothing when no operator is configured", async () => {
    let settles = 0;
    await oweDigestEmail(
      db,
      digestMail([], () => {
        settles += 1;
        return Promise.resolve();
      }),
    );
    expect(await owedDigests()).toStrictEqual([]);
    expect(settles).toBe(0);
  });

  it("reaches the operator's inbox, with Today's words", async () => {
    const { userId, email } = await seedUser();
    const mail = fakeMail();
    const later = owedTo(mail);
    const owing = oweDigestEmail(
      db,
      digestMail([userId], later.owed.settle, {
        ...COUNTS,
        waiting: 0,
        oldestWaitingAt: undefined,
        screenerUnfinished: 0,
        gaveUp: 0,
      }),
    );
    // The fast path is held until the test lets it go.
    await later.settled();
    await owing;
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(email);
    expect(mail.sent[0]?.subject).toMatch(
      / — Nothing waiting\. Nothing failed\.$/u,
    );
    expect(mail.sent[0]?.text).toContain("Open the Desk");
  });
});

describe("the daily firing sends it (D5)", () => {
  it("owes the digest from the digest cron, every day, even with nothing to report", async () => {
    await handleScheduled(DIGEST, undefined, {
      digestMail: digestMail(["op-a"], () => Promise.resolve()),
    });
    expect(await owedDigests()).toStrictEqual([
      `digest:${dayLabel(nowSeconds())}:op-a`,
    ]);
  });

  it("owes no digest from an hourly firing", async () => {
    await handleScheduled(
      { cron: "30 * * * *" } as ScheduledController,
      undefined,
      {
        digestMail: digestMail(["op-a"], () => Promise.resolve()),
      },
    );
    expect(await owedDigests()).toStrictEqual([]);
  });
});
