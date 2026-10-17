import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import {
  coreDbOver,
  DEVICE_BOOKMARK_COOKIE,
  deviceBookmarkCookie,
  deviceBookmarkFrom,
  isWriteStatement,
  newerBookmark,
  offerRunnerBookmark,
  parseBookmark,
  pinPrimary,
  primaryDb,
  runInD1Scope,
  scopedDb,
  scopeOutcome,
  SESSION_ONLY_MESSAGE,
  weatherDbOver,
} from "../../src/lib/sql/d1-session";
import { spiedBinding } from "../d1-spy";

async function selectOne(binding: D1Database): Promise<void> {
  await scopedDb(binding, "core").all(sql`select 1`);
}

const known = { earlier: "", later: "" };

beforeAll(async () => {
  for (const db of [env.DIALED_CORE, env.DIALED_WEATHER]) {
    await db.exec("create table if not exists d1_session_probe (x integer)");
  }
  const session = env.DIALED_CORE.withSession("first-primary");
  await session.prepare("select 1").all();
  known.earlier = session.getBookmark() ?? "";
  await session.prepare("select 1").all();
  known.later = session.getBookmark() ?? "";
});

describe("parseBookmark", () => {
  it("keeps a bookmark in the observed format", () => {
    const value = "00000000-0000003d-00000000-" + "0".repeat(32);
    expect(parseBookmark(value)).toBe(value);
  });

  it("refuses anything D1 would throw on", () => {
    expect(parseBookmark(undefined)).toBeUndefined();
    expect(parseBookmark(42)).toBeUndefined();
    expect(parseBookmark("")).toBeUndefined();
    expect(parseBookmark("first-primary")).toBeUndefined();
    expect(parseBookmark("0a-")).toBeUndefined();
    expect(parseBookmark("-0a")).toBeUndefined();
    expect(parseBookmark("0a--0b")).toBeUndefined();
    expect(parseBookmark("0a;0b")).toBeUndefined();
    expect(parseBookmark("x0a")).toBeUndefined();
    expect(parseBookmark("0a x")).toBeUndefined();
  });

  it("caps the length at 128", () => {
    expect(parseBookmark("a".repeat(128))).toBe("a".repeat(128));
    expect(parseBookmark("a".repeat(129))).toBeUndefined();
  });

  it("accepts either case of hex", () => {
    expect(parseBookmark("0A-0b")).toBe("0A-0b");
  });
});

describe("newerBookmark", () => {
  it("takes whichever exists", () => {
    expect(newerBookmark(undefined, undefined)).toBeUndefined();
    expect(newerBookmark("01", undefined)).toBe("01");
    expect(newerBookmark(undefined, "02")).toBe("02");
  });

  it("takes the later one, by string order", () => {
    expect(newerBookmark("01", "02")).toBe("02");
    expect(newerBookmark("02", "01")).toBe("02");
    expect(newerBookmark("02", "02")).toBe("02");
  });

  it("orders real bookmarks the way D1 issued them", () => {
    expect(newerBookmark(known.earlier, known.later)).toBe(known.later);
    expect(newerBookmark(known.later, known.earlier)).toBe(known.later);
  });
});

describe("isWriteStatement", () => {
  it("sees the statements drizzle writes with", () => {
    expect(isWriteStatement("insert into t values (1)")).toBe(true);
    expect(isWriteStatement("  UPDATE t set x = 1")).toBe(true);
    expect(isWriteStatement("delete from t")).toBe(true);
    expect(isWriteStatement("replace into t values (1)")).toBe(true);
  });

  it("leaves reads alone, and a word that only starts like one", () => {
    expect(isWriteStatement("select * from t")).toBe(false);
    expect(isWriteStatement("select 1 -- insert")).toBe(false);
    expect(isWriteStatement("inserted")).toBe(false);
  });
});

describe("scopedDb outside a request", () => {
  it("is the bare binding, so the primary", async () => {
    const spy = spiedBinding();
    await selectOne(spy.binding);
    expect(spy.bare).toEqual(["select 1"]);
    expect(spy.opened).toEqual([]);
  });

  it("leaves nothing behind", () => {
    expect(scopeOutcome()).toEqual({
      bookmark: undefined,
      writerId: undefined,
    });
  });

  it("ignores a pin and a runner, which only mean something in a request", async () => {
    const spy = spiedBinding();
    pinPrimary("core");
    offerRunnerBookmark("runner-1", known.earlier);
    await selectOne(spy.binding);
    expect(spy.opened).toEqual([]);
  });
});

describe("scopedDb in a request", () => {
  it("opens one unconstrained session, lazily, for every caller", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      scopedDb(spy.binding, "core");
      expect(spy.opened).toEqual([]);
      await selectOne(spy.binding);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-unconstrained"]);
    expect(spy.bare).toEqual([]);
  });

  it("starts core from the device's bookmark", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, () => selectOne(spy.binding));
    expect(spy.opened).toEqual([known.earlier]);
  });

  it("treats a malformed cookie as none", async () => {
    const spy = spiedBinding();
    await runInD1Scope("not;a bookmark", () => selectOne(spy.binding));
    expect(spy.opened).toEqual(["first-unconstrained"]);
  });

  it("never starts weather from the device's bookmark", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, () =>
      scopedDb(spy.binding, "weather").all(sql`select 1`),
    );
    expect(spy.opened).toEqual(["first-unconstrained"]);
  });

  it("keeps the two databases' sessions apart", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      await selectOne(spy.binding);
      await scopedDb(spy.binding, "weather").all(sql`select 1`);
    });
    expect(spy.opened).toEqual(["first-unconstrained", "first-unconstrained"]);
  });

  it("runs a batch on the session", async () => {
    const spy = spiedBinding();
    const counts = await runInD1Scope(undefined, () => {
      const db = scopedDb(spy.binding, "core");
      return db.batch([db.all(sql`select 1 as n`), db.all(sql`select 2 as n`)]);
    });
    expect(counts).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    expect(spy.bare).toEqual([]);
  });

  it("refuses what a session cannot do", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, () => {
      const client = scopedDb(spy.binding, "core").$client;
      expect(() => client.exec("select 1")).toThrow(SESSION_ONLY_MESSAGE);
      expect(() => client.withSession()).toThrow(SESSION_ONLY_MESSAGE);
      return Promise.resolve();
    });
    expect(spy.opened).toEqual([]);
  });

  it("passes exec and withSession to the binding outside a request", async () => {
    const spy = spiedBinding();
    const client = scopedDb(spy.binding, "core").$client;
    await client.exec("select 1");
    client.withSession("first-primary");
    expect(spy.opened).toEqual(["first-primary"]);
  });

  it("decides per query, so a handle made outside a request joins it", async () => {
    const spy = spiedBinding();
    const db = scopedDb(spy.binding, "core");
    await runInD1Scope(undefined, () => db.all(sql`select 1`));
    await db.all(sql`select 1`);
    expect(spy.opened).toEqual(["first-unconstrained"]);
    expect(spy.bare).toEqual(["select 1"]);
  });
});

describe("pinPrimary", () => {
  it("opens first-primary when nothing has been read", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, async () => {
      pinPrimary("core");
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-primary"]);
  });

  it("replaces a session already reading a replica, once", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      await selectOne(spy.binding);
      pinPrimary("core");
      pinPrimary("core");
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-unconstrained", "first-primary"]);
  });

  it("pins only the database it names", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      pinPrimary("weather");
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-unconstrained"]);
  });
});

describe("offerRunnerBookmark", () => {
  it("starts core from the runner's stored bookmark when it is newer", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, async () => {
      offerRunnerBookmark("runner-1", known.later);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual([known.later]);
  });

  it("keeps the device's bookmark when it is the newer one", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.later, async () => {
      offerRunnerBookmark("runner-1", known.earlier);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual([known.later]);
  });

  it("moves an open session forward to a newer stored bookmark", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      await selectOne(spy.binding);
      offerRunnerBookmark("runner-1", known.later);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-unconstrained", known.later]);
  });

  it("does not reopen for nothing new", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.later, async () => {
      await selectOne(spy.binding);
      offerRunnerBookmark("runner-1", undefined);
      offerRunnerBookmark("runner-1", "garbage!");
      offerRunnerBookmark("runner-1", known.earlier);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual([known.later]);
  });

  it("never unpins a pinned session", async () => {
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      pinPrimary("core");
      await selectOne(spy.binding);
      offerRunnerBookmark("runner-1", known.later);
      await selectOne(spy.binding);
    });
    expect(spy.opened).toEqual(["first-primary"]);
  });
});

describe("scopeOutcome", () => {
  it("returns the core session's bookmark and no writer for a read", async () => {
    const spy = spiedBinding();
    const outcome = await runInD1Scope(undefined, async () => {
      offerRunnerBookmark("runner-1", undefined);
      await selectOne(spy.binding);
      return scopeOutcome();
    });
    expect(parseBookmark(outcome.bookmark)).toBe(outcome.bookmark);
    expect(outcome.writerId).toBeUndefined();
  });

  it("names the runner when core was written", async () => {
    const spy = spiedBinding();
    const outcome = await runInD1Scope(undefined, async () => {
      offerRunnerBookmark("runner-1", undefined);
      await scopedDb(spy.binding, "core").run(
        sql`insert into d1_session_probe values (1)`,
      );
      return scopeOutcome();
    });
    expect(outcome.writerId).toBe("runner-1");
  });

  it("names no one for a write nobody signed in made", async () => {
    const spy = spiedBinding();
    const outcome = await runInD1Scope(undefined, async () => {
      await scopedDb(spy.binding, "core").run(
        sql`insert into d1_session_probe values (2)`,
      );
      return scopeOutcome();
    });
    expect(outcome.writerId).toBeUndefined();
  });

  it("ignores a weather write", async () => {
    const outcome = await runInD1Scope(undefined, async () => {
      offerRunnerBookmark("runner-1", undefined);
      await scopedDb(env.DIALED_WEATHER, "weather").run(
        sql`insert into d1_session_probe values (3)`,
      );
      return scopeOutcome();
    });
    expect(outcome.writerId).toBeUndefined();
  });

  it("falls back to the bookmark it was given when nothing was read", async () => {
    const outcome = await runInD1Scope(known.earlier, () =>
      Promise.resolve(scopeOutcome()),
    );
    expect(outcome).toEqual({ bookmark: known.earlier, writerId: undefined });
  });
});

describe("primaryDb", () => {
  it("is the bare binding outside a request", async () => {
    const spy = spiedBinding();
    await primaryDb(spy.binding).all(sql`select 1`);
    expect(spy.bare).toEqual(["select 1"]);
  });

  it("is a first-primary session of its own in a request", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.later, async () => {
      await primaryDb(spy.binding).all(sql`select 1`);
      await primaryDb(spy.binding).all(sql`select 1`);
    });
    expect(spy.opened).toEqual(["first-primary"]);
  });

  it("starts the replica session from what the primary one reached", async () => {
    const spy = spiedBinding();
    const reached = await runInD1Scope(undefined, async () => {
      const primary = primaryDb(spy.binding);
      await primary.all(sql`select 1`);
      await selectOne(spy.binding);
      return scopeOutcome().bookmark;
    });
    expect(spy.opened).toHaveLength(2);
    expect(spy.opened[0]).toBe("first-primary");
    expect(parseBookmark(spy.opened[1])).toBe(spy.opened[1]);
    expect(newerBookmark(spy.opened[1], reached)).toBe(reached);
  });

  it("makes its writes the request's: a writer and the newest bookmark", async () => {
    const spy = spiedBinding();
    const outcome = await runInD1Scope(known.earlier, async () => {
      offerRunnerBookmark("runner-1", undefined);
      await primaryDb(spy.binding).run(
        sql`insert into d1_session_probe values (4)`,
      );
      return scopeOutcome();
    });
    expect(outcome.writerId).toBe("runner-1");
    expect(newerBookmark(known.later, outcome.bookmark)).toBe(outcome.bookmark);
    expect(outcome.bookmark).not.toBe(known.later);
  });
});

describe("the device bookmark cookie", () => {
  const value = "00000000-0000003d-00000000-" + "0".repeat(32);

  it("is called d1b", () => {
    expect(DEVICE_BOOKMARK_COOKIE).toBe("d1b");
  });

  it("finds it among other cookies", () => {
    expect(deviceBookmarkFrom(`a=1; d1b=${value}; b=2`)).toBe(value);
    expect(deviceBookmarkFrom(`d1b=${value}`)).toBe(value);
  });

  it("is nothing when absent or malformed", () => {
    expect(deviceBookmarkFrom(new Headers().get("cookie"))).toBeUndefined();
    expect(deviceBookmarkFrom("")).toBeUndefined();
    expect(deviceBookmarkFrom("a=1")).toBeUndefined();
    expect(deviceBookmarkFrom("xd1b=00")).toBeUndefined();
    expect(deviceBookmarkFrom("d1b=not a bookmark")).toBeUndefined();
    expect(deviceBookmarkFrom("d1b")).toBeUndefined();
  });

  it("round-trips through the header it sets", () => {
    const header = deviceBookmarkCookie(value);
    expect(header).toBe(
      `d1b=${value}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(deviceBookmarkFrom(header.split(";", 1)[0] ?? "")).toBe(value);
  });
});

describe("the handles src/env hands out", () => {
  it("core carries the device's bookmark", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, () =>
      coreDbOver(spy.binding).all(sql`select 1`),
    );
    expect(spy.opened).toEqual([known.earlier]);
  });

  it("weather never does", async () => {
    const spy = spiedBinding();
    await runInD1Scope(known.earlier, () =>
      weatherDbOver(spy.binding).all(sql`select 1`),
    );
    expect(spy.opened).toEqual(["first-unconstrained"]);
  });
});
