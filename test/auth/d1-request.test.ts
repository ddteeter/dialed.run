import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env, waitUntil } from "../../src/env";
import { captureException } from "../../src/modules/ops";
import { newUlid } from "../../src/lib/ids";
import { scopedDb } from "../../src/lib/sql/d1-session";
import {
  storedBookmarkOf,
  storeRunnerBookmark,
} from "../../src/modules/auth/d1-bookmark";
import type { D1RequestDeps } from "../../src/modules/auth/d1-request";
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
const LATER = "00000000-00000002-00000000-" + "0".repeat(32);

function harness(nameQueries?: (pathname: string) => string) {
  const deferred: Promise<void>[] = [];
  const captured: { error: unknown; context: Record<string, string> }[] = [];
  const deps: D1RequestDeps = {
    db,
    nameQueries,
    defer: (work: Promise<void>) => {
      deferred.push(work);
    },
    capture: (error: unknown, context: Record<string, string>) => {
      captured.push({ error, context });
    },
  };
  return { deps, deferred, captured };
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

  it("hands back the handler's own response when it adds nothing", async () => {
    const { deps } = harness();
    const own = new Response("ok");
    const response = await respondInD1Scope(requestWith(), () => own, deps);
    expect(response).toBe(own);
    expect(response.headers.get("x-d1-queries")).toBeNull();
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
    const failing = { ...deps, db: drizzle(new BrokenDatabase(failure)) };
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

  it("reports a session whose bookmark went backwards", async () => {
    const { deps, captured } = harness();
    const response = await respondInD1Scope(
      requestWith(`d1b=${LATER}`),
      async () => {
        await scopedDb(
          spiedBinding(env.DIALED_CORE, DEVICE).binding,
          "core",
        ).all(sql`select 1`);
        return new Response("ok");
      },
      deps,
    );
    expect(response.status).toBe(200);
    expect(captured).toEqual([
      {
        error: new Error(
          "a D1 session ended at a bookmark sorting before the one it started from",
        ),
        context: { job: "d1-bookmark-order", from: LATER, reached: DEVICE },
      },
    ]);
  });

  it("reports nothing for a session that moved forward", async () => {
    const { deps, captured } = harness();
    await respondInD1Scope(
      requestWith(`d1b=${DEVICE}`),
      async () => {
        await scopedDb(
          spiedBinding(env.DIALED_CORE, LATER).binding,
          "core",
        ).all(sql`select 1`);
        return new Response("ok");
      },
      deps,
    );
    expect(captured).toEqual([]);
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

const named = (pathname: string) => `route:${pathname}`;

const asIs = (pathname: string) => pathname;

describe("respondInD1Scope's query count", () => {
  it("says nothing unless the request is named, for a request that ran queries", async () => {
    const { deps } = harness();
    const response = await respondInD1Scope(
      requestWith(),
      async () => {
        await scopedDb(env.DIALED_CORE, "core").all(sql`select 1`);
        return new Response("ok");
      },
      deps,
    );
    expect(response.headers.get("x-d1-queries")).toBeNull();
  });

  it("names the request by its path and counts what it asked, beside the cookie", async () => {
    const { deps } = harness(named);
    const response = await respondInD1Scope(
      requestWith(),
      async () => {
        const core = scopedDb(env.DIALED_CORE, "core");
        await core.all(sql`select 1`);
        await core.all(sql`select 2`);
        return new Response("ok");
      },
      deps,
    );
    expect(response.headers.get("x-d1-queries")).toBe("route:/closet;2;0");
    expect(sentBookmark(response)).toBeDefined();
  });

  it("adds the count alone to a request that read nothing, keeping the response", async () => {
    const { deps } = harness(named);
    const response = await respondInD1Scope(
      requestWith(),
      () => new Response("body", { status: 202, headers: { "x-own": "1" } }),
      deps,
    );
    expect(response.headers.get("x-d1-queries")).toBe("route:/closet;0;0");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-own")).toBe("1");
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("body");
  });
});

describe("d1RequestDepsFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names no request's queries on a build without the flag", () => {
    expect(d1RequestDepsFromEnv(asIs).nameQueries).toBeUndefined();
  });

  it("names them with the namer it is given when VITE_D1_QUERY_TALLY is 1", () => {
    vi.stubEnv("VITE_D1_QUERY_TALLY", "1");
    expect(d1RequestDepsFromEnv(asIs).nameQueries).toBe(asIs);
    vi.stubEnv("VITE_D1_QUERY_TALLY", "true");
    expect(d1RequestDepsFromEnv(asIs).nameQueries).toBeUndefined();
  });

  it("stores through the primary and defers with waitUntil", async () => {
    const deps = d1RequestDepsFromEnv(asIs);
    expect(deps.defer).toBe(waitUntil);
    expect(deps.capture).toBe(captureException);
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    await storeRunnerBookmark(deps.db, userId, DEVICE);
    const [row] = await storedBookmarkOf(db, userId);
    expect(row?.value).toBe(DEVICE);
  });
});

// A class, not an object literal: D1Database still requires the deprecated
// `dump`, and only a class method implements it without reading as a use.
class BrokenDatabase implements D1Database {
  constructor(private readonly failure: Error) {}

  prepare(): never {
    throw this.failure;
  }

  batch(): never {
    throw this.failure;
  }

  exec(): never {
    throw this.failure;
  }

  withSession(): never {
    throw this.failure;
  }

  dump(): never {
    throw this.failure;
  }
}
