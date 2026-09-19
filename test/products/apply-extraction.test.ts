import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { ExtractedProduct } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  applyExtraction,
  ExtractionConflictError,
} from "../../src/modules/products/apply-extraction";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products/service";

/**
 * The precedence rule, one case-table row per test. What makes these more
 * than a re-statement of the table is the row they run against: a real
 * product in D1, with the ledger read back out of the column rather than
 * held in memory between calls.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

async function freshProduct(): Promise<string> {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  const product = await createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    createdBy: newUlid(),
  });
  return product.id;
}

async function rowOf(productId: string) {
  const [row] = await db()
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (row === undefined) throw new Error("row vanished");
  return row;
}

const MERINO: ExtractedProduct = {
  name: "Repeat Merino Tech Tee",
  brand: "Janji",
  fabricComposition: {
    verbatim: "47% merino wool, 53% nylon",
    parts: [
      {
        materials: [
          { material: "merino wool", pct: 47 },
          { material: "nylon", pct: 53 },
        ],
      },
    ],
  },
  weight: "light",
  fabric: "merino",
  windResistant: false,
  waterResistant: true,
  categoryHint: "top",
};

describe("applyExtraction: filling", () => {
  it("fills every never-set column and records what it wrote", async () => {
    const id = await freshProduct();
    const report = await applyExtraction(db(), id, MERINO, "text");

    expect(report).toStrictEqual({
      filled: [
        "fabricComposition",
        "weight",
        "fabric",
        "windResistant",
        "waterResistant",
        "categoryHint",
      ],
      refreshed: [],
      kept: [],
    });

    const row = await rowOf(id);
    expect(row.fabricComposition).toBe("47% merino wool, 53% nylon");
    expect(JSON.parse(row.fabricParts ?? "")).toStrictEqual(
      MERINO.fabricComposition?.parts,
    );
    expect(row.weight).toBe("light");
    expect(row.fabric).toBe("merino");
    // `false` is a finding, not an absence — it must land as false.
    expect(row.windResistant).toBe(false);
    expect(row.waterResistant).toBe(true);
    expect(row.categoryHint).toBe("top");
    expect(row.extractionStatus).toBe("done");

    // The ledger: the full find, the rung, and the precedence record.
    expect(JSON.parse(row.extracted ?? "")).toStrictEqual({
      rung: "text",
      found: MERINO,
      written: {
        fabricComposition: "47% merino wool, 53% nylon",
        weight: "light",
        fabric: "merino",
        windResistant: false,
        waterResistant: true,
        categoryHint: "top",
      },
    });
  });

  it("writes an empty parts list when the composition is verbatim only", async () => {
    const id = await freshProduct();
    await applyExtraction(
      db(),
      id,
      { fabricComposition: { verbatim: "Merino blend" } },
      "llm",
    );
    const row = await rowOf(id);
    expect(row.fabricComposition).toBe("Merino blend");
    expect(row.fabricParts).toBe("[]");
  });

  it("keeps a free-text category hint out of the enum column", async () => {
    // "men's pants/jogger" is what a shop writes; the column is an enum
    // the closet reads. Only an exact member lands, the rest stays in
    // `found` for a mapper that does not exist yet.
    const id = await freshProduct();
    const report = await applyExtraction(
      db(),
      id,
      { categoryHint: "men's pants/jogger" },
      "shopify",
    );
    expect(report.filled).toStrictEqual([]);
    const row = await rowOf(id);
    expect(row.categoryHint).toBeNull();
    expect(JSON.parse(row.extracted ?? "")).toMatchObject({
      found: { categoryHint: "men's pants/jogger" },
      written: {},
    });

    // Case and whitespace are not what makes it a member.
    await applyExtraction(db(), id, { categoryHint: "  Bottom " }, "shopify");
    const after = await rowOf(id);
    expect(after.categoryHint).toBe("bottom");
  });

  it("reports nothing and writes nothing when the ladder found nothing", async () => {
    const id = await freshProduct();
    const report = await applyExtraction(db(), id, {}, "none");
    expect(report).toStrictEqual({ filled: [], refreshed: [], kept: [] });
    const row = await rowOf(id);
    expect(row.extractionStatus).toBe("done");
    expect(JSON.parse(row.extracted ?? "")).toStrictEqual({
      rung: "none",
      found: {},
      written: {},
    });
  });

  it("fails on a product that does not exist", async () => {
    await expect(
      applyExtraction(db(), newUlid(), MERINO, "text"),
    ).rejects.toThrow(/not found/u);
  });
});

describe("applyExtraction: precedence", () => {
  it("refreshes a column it wrote when the ladder finds something new", async () => {
    const id = await freshProduct();
    await applyExtraction(db(), id, { weight: "light" }, "og");
    const report = await applyExtraction(db(), id, { weight: "mid" }, "text");

    expect(report).toStrictEqual({
      filled: [],
      refreshed: ["weight"],
      kept: [],
    });
    const row = await rowOf(id);
    expect(row.weight).toBe("mid");
    expect(JSON.parse(row.extracted ?? "")).toMatchObject({
      rung: "text",
      written: { weight: "mid" },
    });
  });

  it("does nothing to a column whose value it already wrote", async () => {
    const id = await freshProduct();
    await applyExtraction(db(), id, { weight: "light" }, "og");
    const report = await applyExtraction(db(), id, { weight: "light" }, "og");
    expect(report).toStrictEqual({ filled: [], refreshed: [], kept: [] });
  });

  it("never overwrites a column a human edited, and says so", async () => {
    const id = await freshProduct();
    await applyExtraction(
      db(),
      id,
      { weight: "light", fabric: "merino" },
      "og",
    );
    // The edit: a person corrects the weight by hand.
    await db()
      .update(products)
      .set({ weight: "heavy" })
      .where(eq(products.id, id));

    const report = await applyExtraction(
      db(),
      id,
      { weight: "mid", fabric: "blend" },
      "text",
    );
    expect(report).toStrictEqual({
      filled: [],
      refreshed: ["fabric"],
      kept: ["weight"],
    });
    const row = await rowOf(id);
    expect(row.weight).toBe("heavy");
    expect(row.fabric).toBe("blend");
    // The ledger still says what *we* wrote, which is what keeps the column
    // theirs on every later run: it will never equal "light" again.
    expect(JSON.parse(row.extracted ?? "")).toMatchObject({
      written: { weight: "light", fabric: "blend" },
    });

    // And a later run, better ladder or not, still leaves it alone.
    const later = await applyExtraction(db(), id, { weight: "light" }, "llm");
    expect(later.kept).toStrictEqual(["weight"]);
    const after = await rowOf(id);
    expect(after.weight).toBe("heavy");
  });

  it("never refills a column a human cleared", async () => {
    // The case fill-only-what-is-null cannot see: after the clear, the
    // column is null exactly as it was before anyone touched it. Only the
    // ledger knows the difference.
    const id = await freshProduct();
    await applyExtraction(db(), id, { weight: "light" }, "og");
    await db()
      .update(products)
      .set({ weight: sql`NULL` })
      .where(eq(products.id, id));

    const report = await applyExtraction(db(), id, { weight: "light" }, "og");
    expect(report).toStrictEqual({
      filled: [],
      refreshed: [],
      kept: ["weight"],
    });
    const after = await rowOf(id);
    expect(after.weight).toBeNull();
  });

  it("keeps a column it once wrote when a later run has nothing to say about it", async () => {
    // Absent is not "clear it": a rung that did not find the weight this
    // time does not un-find it.
    const id = await freshProduct();
    await applyExtraction(db(), id, { weight: "light" }, "og");
    await applyExtraction(db(), id, { fabric: "merino" }, "text");
    const row = await rowOf(id);
    expect(row.weight).toBe("light");
    expect(JSON.parse(row.extracted ?? "")).toMatchObject({
      written: { weight: "light", fabric: "merino" },
    });
  });

  it("treats a false it wrote as its own, and refreshes it to true", async () => {
    // Booleans are the cell type most likely to be mishandled by a
    // truthiness check: false must compare equal to the false we wrote.
    const id = await freshProduct();
    await applyExtraction(db(), id, { windResistant: false }, "og");
    const report = await applyExtraction(
      db(),
      id,
      { windResistant: true },
      "text",
    );
    expect(report.refreshed).toStrictEqual(["windResistant"]);
    const after = await rowOf(id);
    expect(after.windResistant).toBe(true);
  });
});

describe("applyExtraction: the row changing underneath", () => {
  it("throws rather than clobber when two runs race on one row", async () => {
    // Both read the same ledger; the first update matches it and wins, the
    // second matches nothing. The loser must throw — a redelivery re-runs
    // it against the new ledger — and must not have written anything.
    const id = await freshProduct();
    const results = await Promise.allSettled([
      applyExtraction(db(), id, { weight: "light" }, "og"),
      applyExtraction(db(), id, { weight: "heavy" }, "text"),
    ]);
    const outcomes = results.map((result) => result.status);
    expect(outcomes.filter((status) => status === "rejected")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.reason).toBeInstanceOf(ExtractionConflictError);
    // Named and worded, because this is the error a consumer will match on
    // and a human will read in a DLQ report.
    expect(loser?.reason).toMatchObject({
      name: "ExtractionConflictError",
      message: `Product ${id} changed while extraction was being applied`,
    });

    const row = await rowOf(id);
    const ledger: unknown = JSON.parse(row.extracted ?? "");
    // Whichever won, the column and the ledger agree with each other.
    expect(ledger).toMatchObject({ written: { weight: row.weight } });
  });

  it("refuses to write over a ledger it cannot read", async () => {
    // A corrupted ledger is a ledger that cannot prove precedence. The safe
    // answer is a failed job a human sees, not a fresh start that overwrites
    // whatever a person may have typed.
    const id = await freshProduct();
    await db()
      .update(products)
      .set({ extracted: "{not json", weight: "heavy" })
      .where(eq(products.id, id));
    await expect(
      applyExtraction(db(), id, { weight: "light" }, "og"),
    ).rejects.toThrow();
    const after = await rowOf(id);
    expect(after.weight).toBe("heavy");

    await db()
      .update(products)
      .set({ extracted: JSON.stringify({ rung: "og" }) })
      .where(eq(products.id, id));
    await expect(
      applyExtraction(db(), id, { weight: "light" }, "og"),
    ).rejects.toThrow();
    const after2 = await rowOf(id);
    expect(after2.weight).toBe("heavy");
  });
});
