import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { productSnapshots } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  putSnapshot,
  recordSnapshot,
  snapshotKey,
} from "../../src/modules/enrichment/snapshot";

function db() {
  return drizzle(env.DIALED_CORE);
}

describe("snapshotKey", () => {
  it("puts every snapshot of a product under that product", () => {
    // The prefix is what makes a product's history listable, and what a
    // later re-extraction walks.
    const key = snapshotKey("prod_123", 1_757_700_000_000);
    expect(key).toBe("products/prod_123/snapshot-1757700000000.html");
  });

  it("gives two fetches of one product two keys", () => {
    // Snapshots are permanent (D-31), so a second fetch must not overwrite
    // the page the first one captured.
    expect(snapshotKey("prod_123", 1)).not.toBe(snapshotKey("prod_123", 2));
  });
});

describe("putSnapshot", () => {
  it("stores the page exactly, and says it is HTML", async () => {
    const productId = newUlid();
    const html = "<html><body>88% polyester</body></html>";

    const key = await putSnapshot(productId, html, 1_757_700_000_000);
    const stored = await env.MEDIA.get(key);

    expect(await stored?.text()).toBe(html);
    // Without the type a later reader has to guess, and a browser opening a
    // snapshot for debugging downloads it instead of rendering it.
    expect(stored?.httpMetadata?.contentType).toBe("text/html; charset=utf-8");
  });
});

describe("recordSnapshot", () => {
  it("records where the page went and which rung read it", async () => {
    const productId = newUlid();
    const fetchedAt = 1_757_700_000_000;
    const r2Key = await putSnapshot(productId, "<html></html>", fetchedAt);

    const id = await recordSnapshot(db(), {
      productId,
      url: "https://shop.example.com/p",
      r2Key,
      rung: "shopify",
      fetchedAt,
    });

    const [row] = await db()
      .select()
      .from(productSnapshots)
      .where(eq(productSnapshots.id, id));

    expect(row).toMatchObject({
      productId,
      url: "https://shop.example.com/p",
      r2Key,
      rung: "shopify",
      fetchedAt,
    });
  });

  it("points at an object that is really there", async () => {
    // The reason R2 is written first: a row is a promise that the bytes
    // exist, and `reextract` reads the object rather than re-fetching. A row
    // written before a failed put would be a snapshot that lies.
    const productId = newUlid();
    const fetchedAt = 1_757_700_000_001;
    const r2Key = await putSnapshot(productId, "<html>kept</html>", fetchedAt);

    await recordSnapshot(db(), {
      productId,
      url: "https://shop.example.com/p",
      r2Key,
      rung: "jsonld",
      fetchedAt,
    });

    const [row] = await db()
      .select()
      .from(productSnapshots)
      .where(eq(productSnapshots.productId, productId));
    const stored = await env.MEDIA.get(row?.r2Key ?? "");
    expect(await stored?.text()).toBe("<html>kept</html>");
  });

  it("keeps both snapshots when a product is fetched twice", async () => {
    const productId = newUlid();
    for (const fetchedAt of [1_757_700_000_000, 1_757_700_000_001]) {
      const r2Key = await putSnapshot(
        productId,
        `<html>${String(fetchedAt)}</html>`,
        fetchedAt,
      );
      await recordSnapshot(db(), {
        productId,
        url: "https://shop.example.com/p",
        r2Key,
        rung: "og",
        fetchedAt,
      });
    }

    const rows = await db()
      .select()
      .from(productSnapshots)
      .where(eq(productSnapshots.productId, productId));
    expect(rows).toHaveLength(2);
  });
});
