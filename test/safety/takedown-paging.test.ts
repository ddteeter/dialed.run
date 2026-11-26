import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { takedownRequests } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { removalRequestsSearch } from "../../src/modules/safety/inputs";
import {
  declineLapsedRequests,
  pendingTakedownPage,
} from "../../src/modules/safety/takedowns/takedown-requests";

import { resetSafetyTables } from "./helpers";

/**
 * Review's removal requests, a page at a time (owner, 2026-11-24): those
 * that may act first, then those waiting on a confirm, each soonest due
 * first, and any pending request reached without deciding the ones ahead
 * of it.
 */
const NOW = 1_800_000_000;
const PAGE = 50;

function core() {
  return drizzle(env.DIALED_CORE);
}

interface Seeded {
  readonly id: string;
  readonly isWaiting: boolean;
  readonly dueAt: number;
}

/**
 * Pending requests: `mayAct` that may act and `waiting` waiting on a
 * confirm, their due times spread so the two groups interleave by time,
 * and every third sharing its due time with the one before it.
 */
async function seed(mayAct: number, waiting: number): Promise<Seeded[]> {
  const rows: Seeded[] = [];
  for (let index = 0; index < mayAct + waiting; index += 1) {
    const isWaiting = index >= mayAct;
    // Later ids get earlier due times, so id order is not due order.
    const dueAt = NOW + 3600 - Math.floor(index / 3) * 7 - (isWaiting ? 1 : 0);
    rows.push({ id: newUlid(), isWaiting, dueAt });
  }
  for (const row of rows) {
    await core()
      .insert(takedownRequests)
      .values({
        id: row.id,
        requesterEmail: `r${row.id}@example.com`,
        signature: "x",
        location: `somewhere-${row.id}`,
        dueAt: row.dueAt,
        createdAt: NOW - 60,
        idempotencyKey: newUlid(),
        holdState: row.isWaiting ? "confirm" : "held",
      });
  }
  return rows;
}

/**
#1020's order: may act first, then by due time, then by id.
*/
function inOrder(rows: readonly Seeded[]): string[] {
  return rows
    .toSorted(
      (one, other) =>
        Number(one.isWaiting) - Number(other.isWaiting) ||
        one.dueAt - other.dueAt ||
        (one.id < other.id ? -1 : 1),
    )
    .map((row) => row.id);
}

/**
Every page, from the top, following `next` until there is none.
*/
async function pass(
  between: (page: number) => Promise<void> = () => Promise.resolve(),
) {
  const pages: string[][] = [];
  let after: string | undefined;
  do {
    const page = await pendingTakedownPage(core(), { after, now: NOW });
    pages.push(page.requests.map((request) => request.id));
    after = page.next;
    await between(pages.length);
  } while (after !== undefined);
  return pages;
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
});

describe("Review's removal requests, page by page", () => {
  it("shows every pending request once, in #1020's order, fifty to a page", async () => {
    const rows = await seed(70, 55);
    const pages = await pass();
    expect(pages.map((page) => page.length)).toStrictEqual([PAGE, PAGE, 25]);
    expect(pages.flat()).toStrictEqual(inOrder(rows));
  });

  it("says where each page starts and whether one follows", async () => {
    await seed(60, 0);
    const first = await pendingTakedownPage(core(), { now: NOW });
    expect(first).toMatchObject({ before: 0 });
    expect(first.next).toMatch(/^0\.\d+\.[0-9A-Z]{26}$/u);
    const second = await pendingTakedownPage(core(), {
      after: first.next,
      now: NOW,
    });
    expect(second.before).toBe(PAGE);
    expect(second.requests).toHaveLength(10);
    expect(second.next).toBeUndefined();
  });

  it("has no next page when every request fits on one", async () => {
    await seed(PAGE, 0);
    const only = await pendingTakedownPage(core(), { now: NOW });
    expect(only.requests).toHaveLength(PAGE);
    expect(only.next).toBeUndefined();
  });

  it("shows none twice when a request is confirmed mid-pass, and a pass from the top reaches it at its place", async () => {
    const rows = await seed(70, 55);
    const waiting = inOrder(rows.filter((row) => row.isWaiting));
    const moved = waiting.at(-1) ?? "";
    const pages = await pass(async (page) => {
      if (page !== 2) return;
      // Its confirm: it may act from now on.
      await core()
        .update(takedownRequests)
        .set({ holdState: "held", confirmedAt: NOW })
        .where(eq(takedownRequests.id, moved));
    });
    const seen = pages.flat();
    expect(new Set(seen).size).toBe(seen.length);

    const after = rows.map((row) =>
      row.id === moved ? { ...row, isWaiting: false } : row,
    );
    const again = await pass();
    expect(again.flat()).toStrictEqual(inOrder(after));
    expect(again.flat()).toContain(moved);
  });

  it("loses no other request when ones are decided or lapse mid-pass", async () => {
    const rows = await seed(70, 55);
    const ordered = inOrder(rows);
    const decided = [ordered[10] ?? "", ordered[60] ?? ""];
    const pages = await pass(async (page) => {
      if (page !== 1) return;
      // One already shown and one still ahead are decided, and every
      // request waiting on a confirm lapses.
      await core()
        .update(takedownRequests)
        .set({ status: "removed", resolvedAt: NOW })
        .where(inArray(takedownRequests.id, decided));
      await declineLapsedRequests(core(), NOW + 7200);
    });
    const seen = pages.flat();
    const waiting = new Set(
      rows.filter((row) => row.isWaiting).map((row) => row.id),
    );
    expect(seen).toStrictEqual([
      ...ordered.slice(0, PAGE),
      ...ordered
        .slice(PAGE)
        .filter((id) => !decided.includes(id) && !waiting.has(id)),
    ]);
  });
});

describe("the page's search", () => {
  it("keeps a cursor of the page's own shape", () => {
    const after = `1.${String(NOW)}.01JABCDEFGHJKMNPQRSTVWXYZ0`;
    expect(removalRequestsSearch.parse({ after })).toStrictEqual({ after });
  });

  it("drops anything else, so the list starts from the top", () => {
    for (const after of [
      `2.${String(NOW)}.01JABCDEFGHJKMNPQRSTVWXYZ0`,
      `1.${String(NOW)}.01JABCDEFGHJKMNPQRSTVWXYZ`,
      `1..01JABCDEFGHJKMNPQRSTVWXYZ0`,
      `1.${String(NOW)}.01jabcdefghjkmnpqrstvwxyz0`,
      `1.${String(NOW)}.01JABCDEFGHJKMNPQRSTVWXYZ0 or 1=1`,
      `x1.${String(NOW)}.01JABCDEFGHJKMNPQRSTVWXYZ0`,
      `1.${"9".repeat(17)}.01JABCDEFGHJKMNPQRSTVWXYZ0`,
      7,
      undefined,
    ]) {
      expect(removalRequestsSearch.parse({ after })).toStrictEqual({
        after: undefined,
      });
    }
    expect(removalRequestsSearch.parse({}).after).toBeUndefined();
  });
});
