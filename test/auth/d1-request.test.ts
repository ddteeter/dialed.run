import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env, waitUntil } from "../../src/env";
import { captureException } from "../../src/modules/ops";
import { newUlid } from "../../src/lib/ids";
import { scopedDb } from "../../src/lib/sql/d1-session";
import {
  storedBookmarkOf,
  storeRunnerBookmark,
} from "../../src/modules/auth/d1-bookmark";
import {
  d1RequestDepsFromEnv,
  respondInD1Scope,
} from "../../src/modules/auth/d1-request";
import { agreedUserId } from "../../src/modules/auth/terms-gate";
import { spiedBinding } from "../d1-spy";

/**
 * Design 143's request edge: the `d1b` cookie in, the newest bookmark
 * back out, and the runner's stored bookmark after a write.
 */
const db = drizzle(env.DIALED_CORE);

const DEVICE = "00000000-00000001-00000000-" + "0".repeat(32);

function harness() {
  const deferred: Promise<void>[] = [];
  const captured: { error: unknown; context: Record<string, string> }[] = [];
  return {
    deps: {
      db,
      defer: (work: Promise<void>) => {
        deferred.push(work);
      },
      capture: (error: unknown, context: Record<string, string>) => {
        captured.push({ error, context });
      },
    },
    deferred,
    captured,
  };
}

function requestWith(cookie?: string): Request {
  const init = cookie === undefined ? {} : { headers: { cookie } };
  return new Request("https://dialed.run/closet", init);
}

function sentBookmark(response: Response): string | undefined {
  const header = response.headers.get("set-cookie");
  return /^d1b=([^;]+);/.exec(header ?? "")?.[1];
}

describe("respondInD1Scope", () => {
  it("opens the request's session from the device's cookie", async () => {
    const spy = spiedBinding();
    const { deps } = harness();
    await respondInD1Scope(
      requestWith(`other=1; d1b=${DEVICE}`),
      async () => {
        await scopedDb(spy.binding, "core").all(sql`select 1`);
        return new Response("ok");
      },
      deps,
    );
    expect(spy.opened).toEqual([DEVICE]);
  });

  it("sends back the newest bookmark, keeping the response", async () => {
    const { deps } = harness();
    const response = await respondInD1Scope(
      requestWith(),
      async () => {
        await scopedDb(env.DIALED_CORE, "core").all(sql`select 1`);
        return new Response("body", {
          status: 201,
          headers: { "x-kept": "1" },
        });
      },
      deps,
    );
    expect(sentBookmark(response)).toMatch(/^[0-9a-f-]+$/);
    expect(response.headers.get("set-cookie")).toContain(
      "; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax",
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-kept")).toBe("1");
    expect(await response.text()).toBe("body");
  });

  it("adds no cookie to a request that read nothing", async () => {
    const { deps } = harness();
    const response = await respondInD1Scope(
      requestWith(`d1b=${DEVICE}`),
      () => new Response("ok"),
      deps,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("stores the bookmark for a signed-in runner who wrote, after the response", async () => {
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    const { deps, deferred } = harness();
    const response = await respondInD1Scope(
      requestWith(),
      async () => {
        await agreedUserId(db, { user: { id: userId } });
        await scopedDb(env.DIALED_CORE, "core").run(
          sql`update user_profiles set thermal_level = 2 where user_id = ${userId}`,
        );
        return new Response("ok");
      },
      deps,
    );
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    const [row] = await storedBookmarkOf(db, userId);
    expect(row?.value).toBe(sentBookmark(response));
  });

  it("reports a failed store and still sends the cookie", async () => {
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    const { deps, deferred, captured } = harness();
    const failure = new Error("store failed");
    const fail = (): never => {
      throw failure;
    };
    const broken: D1Database = {
      prepare: fail,
      batch: fail,
      exec: fail,
      withSession: fail,
      dump: fail,
    };
    const failing = { ...deps, db: drizzle(broken) };
    const response = await respondInD1Scope(
      requestWith(),
      async () => {
        await agreedUserId(db, { user: { id: userId } });
        await scopedDb(env.DIALED_CORE, "core").run(
          sql`update user_profiles set thermal_level = 2 where user_id = ${userId}`,
        );
        return new Response("ok");
      },
      failing,
    );
    await Promise.all(deferred);
    expect(sentBookmark(response)).toBeDefined();
    expect(captured).toEqual([
      {
        error: failure,
        context: { userId, job: "d1-bookmark-store" },
      },
    ]);
  });

  it("stores nothing for a read", async () => {
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    const { deps, deferred } = harness();
    await respondInD1Scope(
      requestWith(),
      async () => {
        await agreedUserId(db, { user: { id: userId } });
        await scopedDb(env.DIALED_CORE, "core").all(sql`select 1`);
        return new Response("ok");
      },
      deps,
    );
    expect(deferred).toEqual([]);
  });
});

describe("d1RequestDepsFromEnv", () => {
  it("stores through the primary and defers with waitUntil", async () => {
    const deps = d1RequestDepsFromEnv();
    expect(deps.defer).toBe(waitUntil);
    expect(deps.capture).toBe(captureException);
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    await storeRunnerBookmark(deps.db, userId, DEVICE);
    const [row] = await storedBookmarkOf(db, userId);
    expect(row?.value).toBe(DEVICE);
  });
});
