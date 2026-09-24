import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryTags,
  outfitEntries,
  outfitEntryItems,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  saveBacklogRow,
  unjudgedRunCount,
  verdictBacklog,
} from "../../src/modules/feed/backlog";
import {
  attachKit,
  shouldPromptForVerdict,
} from "../../src/modules/feed/entries";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";

/**
 * DS2's reads and its one write.
 *
 * The table itself is `test/modules/verdict-backlog.dom.test.tsx`; what
 * is here is the two things only a real D1 can answer — which runs are in
 * the backlog at all, and that a saved row lands as an ordinary entry
 * with an ordinary verdict on it. *"Verdicts saved here count exactly
 * like verdicts from the phone."*
 */
const DAY = 86_400;
const PLACE = { lat: 44.98, lng: -93.27 };

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

/**
A run with an observation at the same place and hour.
*/
async function runAt(
  userId: string,
  startedAt: number,
  feelsLikeC: number,
): Promise<string> {
  await makeObservation({
    ...PLACE,
    startedAt,
    tempC: feelsLikeC + 2,
    feelsLikeC,
  });
  return makeRun({ userId, ...PLACE, startedAt });
}

describe("which runs are in the backlog", () => {
  it("holds the runs with no outfit, oldest first", async () => {
    const userId = await makeUser();
    const older = await runAt(userId, NOW - 3 * DAY, 3);
    const newer = await runAt(userId, NOW - DAY, 5);

    const { rows } = await verdictBacklog(userId);

    // Oldest first, which is the order the contract's own header states —
    // a backlog is worked from the end you have forgotten most.
    expect(rows.map((backlogRow) => backlogRow.runId)).toStrictEqual([
      older,
      newer,
    ]);
  });

  it("drops a run the moment it has a verdict, and keeps a kit without one", async () => {
    // The owner's ruling: DS2 and the bell count one set, runs awaiting a
    // verdict — no entry, or an entry whose verdict is null. A kit with no
    // verdict is still waiting; a judged run is done.
    const userId = await makeUser();
    const judged = await runAt(userId, NOW - 3 * DAY, 3);
    const kitOnly = await runAt(userId, NOW - 2 * DAY, 4);
    const bare = await runAt(userId, NOW - DAY, 5);
    await makeEntry({ userId, runId: judged, verdict: 0 });
    await makeEntry({ userId, runId: kitOnly });

    const { rows } = await verdictBacklog(userId);

    expect(rows.map((backlogRow) => backlogRow.runId)).toStrictEqual([
      kitOnly,
      bare,
    ]);
  });

  it("shows nobody else's runs", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    // Different hours: an observation is keyed by place and hour bucket,
    // so two runs at the same place in the same hour are one observation
    // and the second insert is a UNIQUE violation rather than a fixture.
    await runAt(theirs, NOW - 2 * DAY, 3);
    const own = await runAt(mine, NOW - DAY, 3);

    const { rows } = await verdictBacklog(mine);
    expect(rows.map((backlogRow) => backlogRow.runId)).toStrictEqual([own]);
  });

  it("carries the conditions each row is judged against", async () => {
    const userId = await makeUser();
    await runAt(userId, NOW - DAY, 3);

    const { rows } = await verdictBacklog(userId);

    expect(rows[0]?.conditions?.feelsLikeC).toBe(3);
  });

  it("answers an empty table without asking the weather anything", async () => {
    const userId = await makeUser();

    expect(await verdictBacklog(userId)).toStrictEqual({ rows: [] });
  });
});

describe("how many are waiting", () => {
  it("counts what the table would show, for the feed's link", async () => {
    // The feed draws "Clear the queue ›" from a count rather than from
    // the rows: the link needs one number and the table needs everything,
    // and running the full assembly to decide whether to draw a link
    // would cost three reads and a weather round trip on every feed load.
    const userId = await makeUser();
    expect(await unjudgedRunCount(userId)).toBe(0);

    await runAt(userId, NOW - 2 * DAY, 3);
    await runAt(userId, NOW - DAY, 5);
    expect(await unjudgedRunCount(userId)).toBe(2);
  });

  it("stops counting a run the moment it has a verdict", async () => {
    // The same rule the table follows, so the link cannot promise a row
    // the table will not show.
    const userId = await makeUser();
    const judged = await runAt(userId, NOW - 3 * DAY, 3);
    const kitOnly = await runAt(userId, NOW - 2 * DAY, 4);
    await runAt(userId, NOW - DAY, 5);
    await makeEntry({ userId, runId: judged, verdict: -1 });
    await makeEntry({ userId, runId: kitOnly });

    expect(await unjudgedRunCount(userId)).toBe(2);
  });
});

describe("what the outfit cell is offered", () => {
  it("suggests the kit worn in the nearest conditions, with its names", async () => {
    const userId = await makeUser();
    const halfZip = await makeItem({ userId, name: "Janji half-zip" });
    const tee = await makeItem({ userId, name: "Tracksmith tee" });

    // Two prior entries, one much nearer the backlog run's 3°C.
    const nearRun = await runAt(userId, NOW - 10 * DAY, 4);
    await makeEntry({
      userId,
      runId: nearRun,
      verdict: 0,
      itemIds: [halfZip],
      createdAt: NOW - 10 * DAY,
    });
    const farRun = await runAt(userId, NOW - 9 * DAY, 18);
    await makeEntry({
      userId,
      runId: farRun,
      verdict: 0,
      itemIds: [tee],
      createdAt: NOW - 9 * DAY,
    });

    await runAt(userId, NOW - DAY, 3);
    const { rows } = await verdictBacklog(userId);
    const [only] = rows;

    expect(only?.suggestion?.itemNames).toStrictEqual(["Janji half-zip"]);
    expect(only?.suggestion?.itemIds).toStrictEqual([halfZip]);
    // The day the kit was worn, so the cell can say "Same as …?" rather
    // than "a previous run".
    expect(only?.suggestion?.wornAt).toBe(NOW - 10 * DAY);
  });

  it("keeps a deleted garment's id but drops its chip", async () => {
    // A garment the runner has since deleted leaves its id on the entry
    // with no row to name it. The chip is dropped rather than drawn
    // empty; the id stays, so "Use" still attaches what was actually
    // worn. Both halves matter, and neither is visible from the other.
    const userId = await makeUser();
    const kept = await makeItem({ userId, name: "Janji half-zip" });
    const gone = await makeItem({ userId, name: "Deleted tee" });
    const priorRun = await runAt(userId, NOW - 10 * DAY, 4);
    await makeEntry({
      userId,
      runId: priorRun,
      verdict: 0,
      itemIds: [kept, gone],
      createdAt: NOW - 10 * DAY,
    });
    await coreDb().delete(wardrobeItems).where(eq(wardrobeItems.id, gone));

    await runAt(userId, NOW - DAY, 3);
    const { rows } = await verdictBacklog(userId);

    expect(rows[0]?.suggestion?.itemNames).toStrictEqual(["Janji half-zip"]);
    // As a set: the read has no ORDER BY and `outfit_entry_items` has no
    // position column, so the order the ids come back in is SQLite's
    // business. What matters is that the deleted one is still there.
    expect(
      [...(rows[0]?.suggestion?.itemIds ?? [])].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    ).toStrictEqual([kept, gone].toSorted((a, b) => a.localeCompare(b)));
  });

  it("offers nothing when the only prior entry had an empty kit", async () => {
    // An entry with no garments is one the runner saved without attaching
    // anything, and "same as that" offers nothing.
    const userId = await makeUser();
    const priorRun = await runAt(userId, NOW - 10 * DAY, 4);
    await makeEntry({
      userId,
      runId: priorRun,
      verdict: 0,
      createdAt: NOW - 10 * DAY,
    });

    await runAt(userId, NOW - DAY, 3);
    const { rows } = await verdictBacklog(userId);

    expect(rows[0]?.suggestion).toBeUndefined();
  });

  it("offers nothing to a row whose own conditions never resolved", async () => {
    // Nothing to be near. An indoor run, or one the cron has not reached.
    const userId = await makeUser();
    const halfZip = await makeItem({ userId, name: "Janji half-zip" });
    const priorRun = await runAt(userId, NOW - 10 * DAY, 4);
    await makeEntry({
      userId,
      runId: priorRun,
      verdict: 0,
      itemIds: [halfZip],
      createdAt: NOW - 10 * DAY,
    });

    // No observation for this one.
    await makeRun({ userId, ...PLACE, startedAt: NOW - DAY });
    const { rows } = await verdictBacklog(userId);

    expect(rows[0]?.conditions).toBeUndefined();
    expect(rows[0]?.suggestion).toBeUndefined();
  });
});

describe("saving a row", () => {
  it("writes the verdict in the same row it creates, not after it", async () => {
    // **One transaction, because one keystroke.** This used to be
    // `attachKit` then `submitVerdict`, which left a window where the run
    // had an entry and no verdict. Reconciliation would have healed it —
    // but that is law 8c's answer for when you cannot batch, and here you
    // can: every read happens first, and a backlog row has no tags and no
    // flags, so what is left is two inserts.
    //
    // The proof is that the entry is never observable unjudged: it is
    // born with its verdict. Raised on PR #88.
    const userId = await makeUser();
    const halfZip = await makeItem({ userId });
    const runId = await runAt(userId, NOW - DAY, 3);

    const { entryId } = await saveBacklogRow({
      userId,
      runId,
      itemIds: [halfZip],
      verdict: -1,
    });

    const [entry] = await coreDb()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.verdict).toBe(-1);
    // …and the kit landed with it, which is the other half of the batch.
    const items = await coreDb()
      .select({ itemId: outfitEntryItems.itemId })
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, entryId));
    expect(items.map((item) => item.itemId)).toStrictEqual([halfZip]);
  });

  it("is idempotent on a replayed Enter, and does not rewrite the kit", async () => {
    // Law 8b: a repeat returns the row the first call made rather than
    // erroring. A run has exactly one entry (UNIQUE `entries_run`), so
    // the run id is the natural key — and the second save writes only the
    // verdict, leaving the outfit the first one attached.
    const userId = await makeUser();
    const first = await makeItem({ userId, name: "Janji half-zip" });
    const second = await makeItem({ userId, name: "Tracksmith tee" });
    const runId = await runAt(userId, NOW - DAY, 3);

    const one = await saveBacklogRow({
      userId,
      runId,
      itemIds: [first],
      verdict: -1,
    });
    const two = await saveBacklogRow({
      userId,
      runId,
      itemIds: [second],
      verdict: 2,
    });

    expect(two.entryId).toBe(one.entryId);
    const [entry] = await coreDb()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, one.entryId));
    expect(entry?.verdict).toBe(2);
    const items = await coreDb()
      .select({ itemId: outfitEntryItems.itemId })
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, one.entryId));
    expect(items.map((item) => item.itemId)).toStrictEqual([first]);
  });

  it("lands one entry with the kit and the verdict on it", async () => {
    const userId = await makeUser();
    const halfZip = await makeItem({ userId });
    const runId = await runAt(userId, NOW - DAY, 3);

    const { entryId } = await saveBacklogRow({
      userId,
      runId,
      itemIds: [halfZip],
      verdict: -1,
    });

    const [entry] = await coreDb()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.verdict).toBe(-1);
    expect(entry?.runId).toBe(runId);
    expect(entry?.isPublic).toBe(true);

    const items = await coreDb()
      .select({ itemId: outfitEntryItems.itemId })
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, entryId));
    expect(items.map((item) => item.itemId)).toStrictEqual([halfZip]);
  });

  it("honours a runner who keeps their entries private", async () => {
    // The sharing default is `attachKit`'s to apply as it creates the
    // entry — the backlog neither asks for it nor carries it, which is
    // one read fewer per page and one fewer thing to keep in step.
    const quiet = await makeUser({ shareDefault: false });
    const halfZip = await makeItem({ userId: quiet });
    const runId = await runAt(quiet, NOW - DAY, 3);

    const { entryId } = await saveBacklogRow({
      userId: quiet,
      runId,
      itemIds: [halfZip],
      verdict: 0,
    });

    const [entry] = await coreDb()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.isPublic).toBe(false);
  });

  it("saves the verdict and nothing else — no tags, no per-item flags", async () => {
    // "The table is the three inputs A3 leads with. Tags and per-item
    // flags stay on the sheet." A row that quietly wrote either would be
    // the table inventing signal the runner never gave it.
    const userId = await makeUser();
    const halfZip = await makeItem({ userId });
    const runId = await runAt(userId, NOW - DAY, 3);

    const { entryId } = await saveBacklogRow({
      userId,
      runId,
      itemIds: [halfZip],
      verdict: 1,
    });

    const tags = await coreDb()
      .select()
      .from(entryTags)
      .where(eq(entryTags.entryId, entryId));
    expect(tags).toStrictEqual([]);

    const items = await coreDb()
      .select()
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, entryId));
    expect(items).toHaveLength(1);
    // SQL NULL, which is the absence of a per-item signal rather than a
    // signal of "none".
    expect(items[0]?.flag).toBeNull();
  });

  it("leaves a recoverable half-state if the verdict never lands", async () => {
    // The pair is two transactions and cannot be one: D1 has no
    // transaction across two calls, and both of these read before they
    // write. So it is law 8c's *reconciliation*, and this is the marker
    // and the driver it leans on — an entry with `verdict IS NULL` is
    // exactly what the S1 prompt looks for, which is also the state the
    // phone flow leaves whenever a runner attaches a kit and closes the
    // tab. Asserted rather than claimed in a comment.
    const userId = await makeUser();
    const halfZip = await makeItem({ userId });
    const runId = await runAt(userId, NOW - DAY, 3);

    // `attachKit` alone is the half-state a failure between the two
    // calls would leave.
    const entryId = await attachKit({
      userId,
      runId,
      itemIds: [halfZip],
    });

    const [entry] = await coreDb()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.verdict).toBeNull();
    expect(await shouldPromptForVerdict(userId, entryId)).toBe(true);
  });

  it("takes the run out of the backlog", async () => {
    const userId = await makeUser();
    const halfZip = await makeItem({ userId });
    const runId = await runAt(userId, NOW - DAY, 3);

    await saveBacklogRow({
      userId,
      runId,
      itemIds: [halfZip],
      verdict: 2,
    });

    // "It leaves the list on the next visit, not on save" — this is the
    // next visit.
    const { rows } = await verdictBacklog(userId);
    expect(rows).toStrictEqual([]);
  });
});
