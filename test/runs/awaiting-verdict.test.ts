import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { runsAwaitingVerdict } from "../../src/modules/runs";
import {
  makeEntry,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "../feed/helpers";

/**
 * The one definition of "runs awaiting a verdict" (owner's ruling: DS2's
 * backlog and the bell's number are the same set) — no entry, or an entry
 * whose verdict is null, at any age.
 */
const DAY = 86_400;

function awaiting(userId: string, limit = 50) {
  return runsAwaitingVerdict(drizzle(env.DIALED_CORE), userId, limit);
}

beforeEach(async () => {
  await resetTables();
});

describe("runsAwaitingVerdict", () => {
  it("holds a run with no entry, and one whose entry has no verdict", async () => {
    const userId = await makeUser();
    const bare = await makeRun({ userId, startedAt: NOW - 2 * DAY });
    const kitOnly = await makeRun({ userId, startedAt: NOW - DAY });
    const entryId = await makeEntry({ userId, runId: kitOnly });

    const rows = await awaiting(userId);

    // The entry a run already has travels with it, so a row with a kit is
    // never offered a second one; a bare run has none.
    expect(
      rows.map((row) => [row.id, row.entryId ?? "no entry"]),
    ).toStrictEqual([
      [bare, "no entry"],
      [kitOnly, entryId],
    ]);
  });

  it("drops a judged run — Dialed (0) is a verdict, not the absence of one", async () => {
    const userId = await makeUser();
    const dialed = await makeRun({ userId, startedAt: NOW - 3 * DAY });
    const cold = await makeRun({ userId, startedAt: NOW - 2 * DAY });
    const waiting = await makeRun({ userId, startedAt: NOW - DAY });
    await makeEntry({ userId, runId: dialed, verdict: 0 });
    await makeEntry({ userId, runId: cold, verdict: -2 });

    const rows = await awaiting(userId);

    expect(rows.map((row) => row.id)).toStrictEqual([waiting]);
  });

  it("has no age window: a run from last year still waits", async () => {
    const userId = await makeUser();
    const old = await makeRun({ userId, startedAt: NOW - 400 * DAY });

    const rows = await awaiting(userId);

    expect(rows.map((row) => row.id)).toStrictEqual([old]);
  });

  it("is the runner's own, oldest first, and capped in SQL", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await makeRun({ userId: theirs, startedAt: NOW - 5 * DAY });
    const newest = await makeRun({ userId: mine, startedAt: NOW - DAY });
    const oldest = await makeRun({ userId: mine, startedAt: NOW - 3 * DAY });
    const middle = await makeRun({ userId: mine, startedAt: NOW - 2 * DAY });

    const all = await awaiting(mine);
    const capped = await awaiting(mine, 2);

    expect(all.map((row) => row.id)).toStrictEqual([oldest, middle, newest]);
    expect(capped.map((row) => row.id)).toStrictEqual([oldest, middle]);
  });

  it("carries what a backlog row draws", async () => {
    const userId = await makeUser();
    const id = await makeRun({
      userId,
      startedAt: NOW - DAY,
      durationS: 2400,
      lat: 44.5,
      lng: -93.5,
    });

    const rows = await awaiting(userId);

    expect(
      rows.map((row) => ({ ...row, entryId: row.entryId ?? "no entry" })),
    ).toStrictEqual([
      {
        id,
        startedAt: NOW - DAY,
        durationS: 2400,
        distanceM: 5000,
        lat: 44.5,
        lng: -93.5,
        entryId: "no entry",
      },
    ]);
  });
});
