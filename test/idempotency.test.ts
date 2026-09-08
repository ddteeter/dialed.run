import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { follows, outfitEntries } from "../src/db/schema-core";
import { env } from "../src/env";
import { newUlid } from "../src/lib/ids";
import { createItem } from "../src/modules/closet/service";
import { attachKit } from "../src/modules/feed/entries";
import { follow } from "../src/modules/feed/follows";
import { toggleUsefulReaction } from "../src/modules/feed/reactions";
import { createOrGetBrand, createOrGetProduct } from "../src/modules/products/service";
import { makeEntry, makeItem, makeRun, makeUser, resetTables } from "./feed/helpers";

/**
 * Task 108. Every server function that **creates** a row from a user action
 * survives being called twice with the same intent.
 *
 * A double-click, a browser replaying a POST, and a retry over a flaky
 * connection are indistinguishable from a genuine second submission unless
 * the request carries something to tell them apart (CLAUDE.md law 8b). The
 * cost of getting it wrong is not an error — it is a duplicate the user has
 * to notice and delete.
 *
 * Two shapes of answer, and the tests look different because of it:
 *
 * - **A natural key already exists** — a UNIQUE pair, an upsert, a parent
 *   that can only have one child. Those paths need no column, and the
 *   deliverable is a test pinning the property so a later refactor cannot
 *   quietly remove it.
 * - **No natural key** — a client-generated `idempotency_key`, UNIQUE and
 *   scoped, and a repeat that returns the first row rather than erroring.
 */
function db() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

describe("keyed paths: same key twice returns the same row", () => {
  it("garment create", async () => {
    const userId = await makeUser();
    const key = newUlid();
    const garment = { category: "top", name: "Janji Rover", type: "halfZip" } as const;

    const first = await createItem(db(), userId, garment, "manual", key);
    const second = await createItem(db(), userId, garment, "manual", key);
    expect(second.id).toBe(first.id);

    const third = await createItem(db(), userId, garment, "manual", newUlid());
    expect(third.id).not.toBe(first.id);
  });

  it("garment create does not leak a row across users", async () => {
    // The key comes from the client, so two accounts can mint the same one.
    // Returning the first user's garment to the second would be a
    // cross-account read, which is why the index is (user_id, key) and not
    // key alone.
    const [alice, bob] = [await makeUser(), await makeUser()];
    const shared = newUlid();
    const mine = await createItem(
      db(),
      alice,
      { category: "top", name: "Alice's singlet" },
      "manual",
      shared,
    );
    const theirs = await createItem(
      db(),
      bob,
      { category: "top", name: "Bob's singlet" },
      "manual",
      shared,
    );
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.name).toBe("Bob's singlet");
  });

  it("garment create without a key still creates every time", async () => {
    // The column is nullable and the index is UNIQUE, so two NULL keys must
    // not collide — SQLite treats NULLs as distinct in a unique index, and
    // the tap-list and imports depend on it.
    const userId = await makeUser();
    const garment = { category: "socks", name: "No-show socks" } as const;
    const first = await createItem(db(), userId, garment);
    const second = await createItem(db(), userId, garment);
    expect(second.id).not.toBe(first.id);
  });
});

describe("natural keys: no column needed, property pinned", () => {
  it("attaching a kit twice returns the first entry", async () => {
    // `entries_run` is UNIQUE, so the run id *is* the key. Before this, the
    // second attach hit that index and threw.
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const itemId = await makeItem({ userId });

    const first = await attachKit({ userId, runId, itemIds: [itemId] });
    const second = await attachKit({ userId, runId, itemIds: [itemId] });
    expect(second).toBe(first);
  });

  it("a kit that fails to save leaves no half-entry behind", async () => {
    // The entry and the items in it are one fact, so they go in one
    // `db.batch()` — CLAUDE.md's "default to one batch". They used to be two
    // awaited inserts, and a failure between them left an entry with no
    // garments in it, which renders as an empty kit and cannot be told from
    // a deliberate one.
    //
    // Forced here by passing the same item twice, which violates the UNIQUE
    // `entry_items_pk` pair. With two statements the entry survives; in a
    // batch it does not.
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const itemId = await makeItem({ userId });

    await expect(
      attachKit({ userId, runId, itemIds: [itemId, itemId] }),
    ).rejects.toThrow();

    const orphans = await db()
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.runId, runId));
    expect(orphans).toEqual([]);
  });

  it("brand and product create-if-missing are keyed on their normalised name", async () => {
    const userId = await makeUser();
    const brand = await createOrGetBrand(db(), "Janji");
    // Different spelling, same normalised identity.
    const again = await createOrGetBrand(db(), "  janji  ");
    expect(again.id).toBe(brand.id);

    const product = await createOrGetProduct(db(), {
      brandId: brand.id,
      name: "Rover Half-Zip",
      createdBy: userId,
    });
    const productAgain = await createOrGetProduct(db(), {
      brandId: brand.id,
      name: "rover half-zip",
      createdBy: userId,
    });
    expect(productAgain.id).toBe(product.id);
  });

  it("following twice is one row", async () => {
    const [follower, followee] = [await makeUser(), await makeUser()];
    await follow(follower, followee);
    await follow(follower, followee);
    const rows = await db()
      .select({ followeeId: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, follower));
    expect(rows).toHaveLength(1);
  });
});

describe("a toggle is not a create, and must not be made idempotent", () => {
  it("reacting twice removes the reaction", async () => {
    // `toggleUsefulReaction` is deliberately *not* idempotent: two clicks
    // mean on-then-off, which is the whole point of a toggle. The UNIQUE
    // pair stops a duplicate row; it does not and should not stop the
    // second call from meaning something different.
    //
    // Pinned because "make every write idempotent" applied blindly here
    // would break the feature.
    const [author, viewer] = [await makeUser(), await makeUser()];
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId });

    expect(await toggleUsefulReaction(entryId, viewer)).toEqual({ useful: true });
    expect(await toggleUsefulReaction(entryId, viewer)).toEqual({ useful: false });
    expect(await toggleUsefulReaction(entryId, viewer)).toEqual({ useful: true });
  });
});
