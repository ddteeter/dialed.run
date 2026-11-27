import { describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { profileCacheTags } from "../../src/lib/cache-tags";
import { newUlid } from "../../src/lib/ids";
import {
  PURGES_PER_RUNNER_PER_MINUTE,
  purgeAndSync,
  purgeAndSyncWithin,
  purgePublicPages,
  purgePublicPagesFor,
  purgeTags,
  type EdgeCache,
  type PurgeDeps,
} from "../../src/modules/ops/public-web/edge-purge";

/**
 * The edge purge (design 163): one call per retraction, in the
 * background, never failing the write, and a refusal reported.
 */
function harness(edge: EdgeCache) {
  const kept: Promise<unknown>[] = [];
  const report = vi.fn<PurgeDeps["report"]>();
  const deps: PurgeDeps = {
    edge,
    keepAlive: (promise) => {
      kept.push(promise);
    },
    report,
  };
  return { deps, kept, report, settled: () => Promise.all(kept) };
}

const purged = (): CachePurgeResult => ({ success: true, errors: [] });

describe("purgeTags", () => {
  it("purges every tag once, in one call, kept alive past the response", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const { deps, kept, report, settled } = harness({ purge });

    purgeTags(deps, ["entry:e1", "runner:u1", "entry:e1"]);
    await settled();

    expect(purge.mock.calls).toStrictEqual([
      [{ tags: ["entry:e1", "runner:u1"] }],
    ]);
    expect(kept).toHaveLength(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("calls the cache's own purge, on the cache", async () => {
    const edge = {
      calls: [] as string[][],
      purge(this: { calls: string[][] }, options: CachePurgeOptions) {
        this.calls.push(options.tags ?? []);
        return Promise.resolve(purged());
      },
    };
    const { deps, settled } = harness(edge);

    purgeTags(deps, ["runner:u1"]);
    await settled();

    expect(edge.calls).toStrictEqual([["runner:u1"]]);
  });

  it("names nothing when there is nothing to purge", () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const { deps, kept } = harness({ purge });

    purgeTags(deps, []);

    expect(purge).not.toHaveBeenCalled();
    expect(kept).toHaveLength(0);
  });

  it("does nothing where the runtime has no Workers Caching", () => {
    const { deps, kept, report } = harness({});

    expect(() => {
      purgeTags(deps, ["runner:u1"]);
    }).not.toThrow();
    expect(kept).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a refusal with the tags and the reasons, never failing", async () => {
    const { deps, report, settled } = harness({
      purge: () =>
        Promise.resolve({
          success: false,
          errors: [
            { code: 1134, message: "rate limited" },
            { code: 7, message: "busy" },
          ],
        }),
    });

    purgeTags(deps, ["entry:e1", "runner:u1"]);
    await settled();

    expect(report.mock.calls).toStrictEqual([
      [
        new Error("edge purge refused"),
        {
          tags: "entry:e1,runner:u1",
          errors: "1134 rate limited; 7 busy",
        },
      ],
    ]);
  });

  it("reports a purge that rejects, with the tags", async () => {
    const failure = new Error("network");
    const { deps, report, settled } = harness({
      purge: () => Promise.reject(failure),
    });

    purgeTags(deps, ["runner:u1"]);
    await settled();

    expect(report.mock.calls).toStrictEqual([[failure, { tags: "runner:u1" }]]);
  });

  it("reports a purge that throws before it returns, and never throws itself", async () => {
    const failure = new Error("sync");
    const { deps, report, settled } = harness({
      purge: () => {
        throw failure;
      },
    });

    expect(() => {
      purgeTags(deps, ["runner:u1"]);
    }).not.toThrow();
    await settled();

    expect(report.mock.calls).toStrictEqual([[failure, { tags: "runner:u1" }]]);
  });
});

describe("what a failed purge reports", () => {
  it("names a refused profile purge by the runner's id, never the handle", async () => {
    const { deps, report, settled } = harness({
      purge: () =>
        Promise.resolve({
          success: false,
          errors: [{ code: 1134, message: "rate limited" }],
        }),
    });

    purgeTags(deps, profileCacheTags("u1", "maya"));
    await settled();

    expect(report.mock.calls).toStrictEqual([
      [
        new Error("edge purge refused"),
        { tags: "runner:u1,handle:", errors: "1134 rate limited" },
      ],
    ]);
  });

  it("names a profile purge that rejects by the runner's id, never the handle", async () => {
    const failure = new Error("network");
    const { deps, report, settled } = harness({
      purge: () => Promise.reject(failure),
    });

    purgeTags(deps, [...profileCacheTags("u1", "maya"), "entry:e1"]);
    await settled();

    expect(report.mock.calls).toStrictEqual([
      [failure, { tags: "runner:u1,handle:,entry:e1" }],
    ]);
  });

  it("still purges the handle's page itself", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const { deps, settled } = harness({ purge });

    purgeTags(deps, profileCacheTags("u1", "maya"));
    await settled();

    expect(purge.mock.calls).toStrictEqual([
      [{ tags: ["runner:u1", "handle:maya"] }],
    ]);
  });
});

describe("purgeAndSync", () => {
  it("purges the tags and syncs the public photos of the kits and runners they name", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const { deps, settled } = harness({ purge });
    const sync = vi.fn();

    purgeAndSync(deps, sync, ["entry:e1", "runner:u1", "handle:maya"]);
    await settled();

    expect(purge.mock.calls).toStrictEqual([
      [{ tags: ["entry:e1", "runner:u1", "handle:maya"] }],
    ]);
    expect(sync.mock.calls).toStrictEqual([
      [{ entryIds: ["e1"], runnerIds: ["u1"] }],
    ]);
  });
});

describe("purgePublicPages", () => {
  it("degrades to nothing in a runtime without Workers Caching, as vitest's is", () => {
    // workerd under vitest exports `cache` with no `purge` (checked
    // 2026-10-28, even with `cache.enabled` in the test config): the
    // writer's purge must neither throw nor wait.
    expect(() => {
      purgePublicPages(["runner:u1"]);
    }).not.toThrow();
  });
});

/**
Everything a purge kept alive has settled, including what it kept alive in turn.
*/
async function allSettled(kept: Promise<unknown>[]): Promise<void> {
  let seen = 0;
  while (seen < kept.length) {
    seen = kept.length;
    await Promise.all(kept);
  }
}

describe("purgeAndSyncWithin (SA-L15)", () => {
  it("purges and syncs while the runner's share allows", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const sync = vi.fn();
    const { deps, kept } = harness({ purge });

    purgeAndSyncWithin(deps, sync, () => Promise.resolve(true), ["entry:e1"]);
    await allSettled(kept);

    expect(purge.mock.calls).toStrictEqual([[{ tags: ["entry:e1"] }]]);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("past the share, syncs the photos and leaves the page to its lifetime", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const sync = vi.fn();
    const { deps, kept } = harness({ purge });

    purgeAndSyncWithin(deps, sync, () => Promise.resolve(false), ["entry:e1"]);
    await allSettled(kept);

    expect(purge).not.toHaveBeenCalled();
    expect(sync.mock.calls).toStrictEqual([
      [{ entryIds: ["e1"], runnerIds: [] }],
    ]);
  });

  it("purges when the count cannot answer", async () => {
    const purge = vi.fn(() => Promise.resolve(purged()));
    const { deps, kept } = harness({ purge });

    purgeAndSyncWithin(deps, vi.fn(), () => Promise.reject(new Error("d1")), [
      "entry:e1",
    ]);
    await allSettled(kept);

    expect(purge).toHaveBeenCalledOnce();
  });
});

describe("purgePublicPagesFor (SA-L15)", () => {
  it("counts each of the runner's purges, a minute at a time", async () => {
    const userId = newUlid();
    const db = drizzle(env.DIALED_CORE);

    purgePublicPagesFor(userId)([`runner:${userId}`]);

    await vi.waitFor(async () => {
      const [row] = await db
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.subject, userId));
      expect(row).toMatchObject({ kind: "purge-runner", count: 1 });
    });
    expect(PURGES_PER_RUNNER_PER_MINUTE).toBe(2);
  });
});
