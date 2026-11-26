/**
 * `dialed/table-writes` (design 263), fed probes. The rule lands at zero
 * hits over `src`, and a rule that read nothing would also report zero, so
 * a clean `npm run lint` proves nothing about it. Each probe is linted at
 * the path of a real file, so it is typed in the real program and lands in
 * that file's module; only this rule's messages are kept.
 *
 * In the `node` project because ESLint reads the config from disk.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { areaOf } from "../../eslint/table-writes";

const eslint = new ESLint({
  ruleFilter: ({ ruleId }) => ruleId === "dialed/table-writes",
});

/**
Real files, three folders down, so the probes' imports are the same.
*/
const IN = {
  feed: "src/modules/feed/following/follows.ts",
  safety: "src/modules/safety/reports/blocks.ts",
  ops: "src/modules/ops/desk/gave-up.ts",
} as const;

const HEAD = `
import { eq, type SQL } from "drizzle-orm";
import type { SQLiteTable, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import * as schema from "../../../db/schema-core";
import { entryPhotos, follows, outfitEntries, outbox, runs } from "../../../db/schema-core";
import { coreDb } from "../../../env";
import { didClaim } from "../../../lib/sql/claim";
const db = coreDb();
`;

async function messagesIn(
  module: keyof typeof IN,
  body: string,
): Promise<string[]> {
  const [result] = await eslint.lintText(`${HEAD}${body}`, {
    filePath: IN[module],
  });
  return (result?.messages ?? []).map((message) => message.message);
}

const NOT_LISTED =
  /^`(\w+)` writes `(\w+)` \((\w+)\), which the owner map gives to `(\w+)`/u;

describe("a module's own table", () => {
  it.each([
    [
      "an insert",
      "await db.insert(follows).values({ followerId: 'a', followeeId: 'b', createdAt: 1 });",
    ],
    ["an update", "await db.update(follows).set({ createdAt: 2 });"],
    [
      "a delete",
      "await db.delete(follows).where(eq(follows.followerId, 'a'));",
    ],
    ["through a namespace", "await db.delete(schema.follows);"],
  ])("passes %s", async (_kind, body) => {
    expect(await messagesIn("feed", body)).toStrictEqual([]);
  });
});

describe("another module's table", () => {
  it("fails a module the map does not list", async () => {
    const [message = ""] = await messagesIn("feed", "await db.delete(outbox);");
    expect(NOT_LISTED.exec(message)?.slice(1)).toStrictEqual([
      "feed",
      "outbox",
      "delete",
      "ops",
    ]);
  });

  it("passes a kind the map lists, and fails one it does not", async () => {
    // `account` may only delete `outbox`; `safety` may only delete `follows`.
    expect(
      await messagesIn("safety", "await db.delete(follows);"),
    ).toStrictEqual([]);
    expect(
      await messagesIn(
        "safety",
        "await db.insert(follows).values({ followerId: 'a', followeeId: 'b', createdAt: 1 });",
      ),
    ).toStrictEqual([
      "`safety` makes a insert on `follows` (owned by `feed`), and the owner map lists no insert for it.",
    ]);
  });

  it("fails an update by a writer the map lists only for deletes", async () => {
    expect(
      await messagesIn(
        "safety",
        "await db.update(follows).set({ createdAt: 2 });",
      ),
    ).toStrictEqual([
      "`safety` makes a update on `follows` (owned by `feed`), and the owner map lists no update for it.",
    ]);
  });

  it("passes a column group's own column, and fails any other", async () => {
    expect(
      await messagesIn(
        "safety",
        "await db.update(outfitEntries).set({ moderationStatus: 'hidden' });",
      ),
    ).toStrictEqual([]);
    expect(
      await messagesIn(
        "safety",
        "await db.update(outfitEntries).set({ moderationStatus: 'hidden', caption: 'x' });",
      ),
    ).toStrictEqual([
      "`safety` updates `outfit_entries`.caption, which the owner map does not list for it (`feed` owns the table).",
    ]);
  });

  it("reads a `.set()` typed as the whole table as every column", async () => {
    const body = `
export async function f(values: SQLiteUpdateSetSource<typeof outfitEntries>) {
  await db.update(outfitEntries).set(values);
}`;
    expect(await messagesIn("safety", body)).toStrictEqual([
      "`safety` updates `outfit_entries`.id, runId, userId, createdAt, verdict, audience, caption, which the owner map does not list for it (`feed` owns the table).",
    ]);
  });

  it("fails an update whose `.set()` the chain does not show", async () => {
    const body = "export const pending = db.update(outfitEntries);";
    expect(await messagesIn("safety", body)).toStrictEqual([
      expect.stringMatching(/^`safety` may update only some columns/u),
    ]);
  });
});

describe("tables in an array", () => {
  it("checks every table the array holds", async () => {
    const body =
      "await db.batch([follows, outbox].map((table) => db.delete(table)) as never);";
    const messages = await messagesIn("feed", body);
    expect(messages).toStrictEqual([
      expect.stringMatching(/`feed` writes `outbox`/u),
    ]);
  });

  it("fails an array whose type names no table", async () => {
    const body = `
const tables: readonly SQLiteTable[] = [follows];
for (const table of tables) await db.delete(table);`;
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(
        /^Which table this delete writes cannot be read from its type/u,
      ),
    ]);
  });
});

describe("writes through a helper", () => {
  it("checks a generic helper where it is called, in the caller's module", async () => {
    const body = `
function wipe<T extends SQLiteTable>(table: T) {
  return db.delete(table);
}
await wipe(follows);
await wipe(outbox);`;
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(/^`feed` writes `outbox` \(delete\)/u),
    ]);
  });

  it("follows a table through a property and a second helper", async () => {
    const body = `
function setOn<T extends SQLiteTable>(table: T, values: SQLiteUpdateSetSource<T>, also?: SQL) {
  return db.update(table).set(values).where(also);
}
function setHeld<T extends SQLiteTable>(subject: { table: T }, values: SQLiteUpdateSetSource<T>) {
  return setOn(subject.table, values);
}
await setHeld({ table: entryPhotos }, { screenStatus: "flagged" });
await setHeld({ table: entryPhotos }, { screenStatus: "flagged", entryId: "e" });`;
    expect(await messagesIn("safety", body)).toStrictEqual([
      "`safety` updates `entry_photos`.entryId, which the owner map does not list for it (`feed` owns the table).",
    ]);
  });

  it("checks a helper with a plain `SQLiteTable` parameter at its call", async () => {
    const body = `
function wipe(table: SQLiteTable) {
  return db.delete(table);
}
await wipe(outbox);`;
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(/^`feed` writes `outbox` \(delete\)/u),
    ]);
  });

  it("checks a helper from another file (`didClaim`)", async () => {
    const body = `
await didClaim(db, runs, { id: runs.id, status: runs.weatherStatus }, "r", ["pending"], { weatherStatus: "done" });
await didClaim(db, runs, { id: runs.id, status: runs.weatherStatus }, "r", ["pending"], { weatherStatus: "done", startedAt: 1 });`;
    expect(await messagesIn("ops", body)).toStrictEqual([
      "`ops` updates `runs`.startedAt, which the owner map does not list for it (`runs` owns the table).",
    ]);
  });

  it("checks an arrow helper held in a variable", async () => {
    const body = `
const wipe = (table: SQLiteTable) => db.delete(table);
await wipe(outbox);`;
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(/^`feed` writes `outbox` \(delete\)/u),
    ]);
  });

  it("fails a callback written in place, whose caller it cannot find", async () => {
    const body =
      "[follows].forEach((table: SQLiteTable) => void db.delete(table));";
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(/^Which table this delete writes/u),
    ]);
  });

  it("fails a writing helper handed on as a value", async () => {
    const body = `
function wipe(table: SQLiteTable) {
  return db.delete(table);
}
export const wipes = [follows].map(wipe);`;
    expect(await messagesIn("feed", body)).toStrictEqual([
      expect.stringMatching(/^This function writes a table it is passed/u),
    ]);
  });
});

describe("what is not a write", () => {
  it("ignores a delete on anything but a table", async () => {
    const body = `
declare const bucket: R2Bucket;
const seen = new Set<string>(["a"]);
seen.delete("a");
new Map<string, number>().delete("a");
await bucket.delete("key");`;
    expect(await messagesIn("feed", body)).toStrictEqual([]);
  });
});

describe("the module a file is in", () => {
  it.each([
    ["/repo/src/modules/feed/entries/entries.ts", "feed"],
    ["/repo/src/modules/ops/index.ts", "ops"],
    ["/repo/src/db/gave-up.ts", "src/db"],
    ["/repo/src/routes/feed/index.tsx", "src/routes"],
    ["/repo/src/server.ts", "src"],
    [String.raw`C:\repo\src\modules\runs\service.ts`, "runs"],
  ])("reads %s as %s", (path, area) => {
    expect(areaOf(path)).toBe(area);
  });
});
