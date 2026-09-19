import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { brands, products as productsTable } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { normalizeIdentity } from "../../src/lib/normalize";
import {
  clustersIn,
  duplicateProducts,
} from "../../src/modules/safety/duplicates";

import { NOW, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * The clustering rule, tested on the cases that decide whether an
 * operator keeps reading the report.
 *
 * `products_brand_name` already makes an exactly-normalised collision
 * impossible, so everything here is a NEAR miss: a plural, a stray word,
 * a year. What it must NOT do is pair genuinely different products,
 * because a report full of those is one nobody opens twice.
 */

describe("names that are the same product", () => {
  it("groups a plural with its singular", () => {
    expect(clustersIn(["thermal tight", "thermal tights"])).toEqual([
      ["thermal tight", "thermal tights"],
    ]);
  });

  it("groups a name with the same name plus a year", () => {
    expect(clustersIn(["rapid lite short", "rapid lite short 2"])).toEqual([
      ["rapid lite short", "rapid lite short 2"],
    ]);
  });

  it("groups three spellings into one cluster, not three pairs", () => {
    // An operator wants one row per mess, not one per pairing.
    const clusters = clustersIn([
      "merino base layer",
      "merino base layers",
      "merino base layer 2",
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });
});

describe("names that are different products", () => {
  it("does not pair two names that merely share a word", () => {
    // "tight" and "short" are different garments that happen to share a
    // brand's house adjective.
    expect(clustersIn(["thermal tight", "thermal short"])).toEqual([]);
  });

  it("does not pair a one-word name with a two-word one", () => {
    // "tight" and "thermal tight" are as likely to be two products as
    // one, and guessing wrong here is what makes a report unreadable.
    expect(clustersIn(["tight", "thermal tight"])).toEqual([]);
  });

  it("refuses names that differ by more than one token", () => {
    expect(clustersIn(["thermal tight", "thermal tight winter 2"])).toEqual([]);
  });

  it("does not report a single product as a duplicate of itself", () => {
    expect(clustersIn(["thermal tight"])).toEqual([]);
  });

  it("does not report an exact repeat, which the UNIQUE index prevents", () => {
    // Two rows cannot hold the same normalised name under one brand, so a
    // cluster of identical strings would be reporting an impossible state.
    expect(clustersIn(["thermal tight", "thermal tight"])).toEqual([]);
  });

  it("finds nothing in an empty catalogue", () => {
    expect(clustersIn([])).toEqual([]);
  });
});

describe("clusters do not overlap", () => {
  it("claims a name once, so two clusters cannot both contain it", () => {
    const clusters = clustersIn([
      "merino base layer",
      "merino base layers",
      "rapid lite short",
      "rapid lite shorts",
    ]);

    expect(clusters).toHaveLength(2);
    const everyName = clusters.flat();
    expect(new Set(everyName).size).toBe(everyName.length);
  });
});

describe("the edges of the matching rule", () => {
  it("does not treat a name as a duplicate of itself", () => {
    // `areNearlyTheSame` refuses an exact match, which is what stops a
    // single product clustering with its own row.
    expect(clustersIn(["thermal tight", "thermal tight"])).toEqual([]);
  });

  it("ignores repeated spaces, which normalisation should have removed", () => {
    // Defensive rather than expected: `normalizeIdentity` folds runs of
    // whitespace, so a double space here means something upstream
    // changed — and splitting naively would make an empty token that
    // counts toward the length comparison.
    expect(clustersIn(["thermal  tight", "thermal tights"])).toEqual([
      ["thermal  tight", "thermal tights"],
    ]);
  });

  it("requires the shared tokens to be in the same ORDER", () => {
    // "tight thermal" is the same two words rearranged, which a set
    // comparison would happily call a duplicate.
    expect(clustersIn(["thermal tight", "tight thermal"])).toEqual([]);
  });

  it("requires the shorter name to be a PREFIX, not merely contained", () => {
    // Shares two tokens and differs by one in length, but the extra word
    // is at the front — so these start differently and are two products.
    expect(clustersIn(["winter thermal tight", "thermal tight"])).toEqual([]);
  });

  it("accepts a two-character marker and refuses a three-character word", () => {
    // The boundary is what separates "short 24" (a year) from "short
    // long" (a different garment).
    expect(clustersIn(["rapid lite short", "rapid lite short 24"])).toEqual([
      ["rapid lite short", "rapid lite short 24"],
    ]);
    expect(clustersIn(["rapid lite short", "rapid lite short pro"])).toEqual(
      [],
    );
  });

  it("accepts a two-character spelling difference and refuses a longer one", () => {
    // "tight"/"tights" is one character; "tight"/"tightest" is three and
    // is a different product name.
    expect(clustersIn(["thermal tight", "thermal tights"])).toHaveLength(1);
    expect(clustersIn(["thermal tight", "thermal tightest"])).toEqual([]);
  });

  it("refuses a difference that is not a prefix, however short", () => {
    // "tight" and "light" are one character apart and completely
    // different garments — the Levenshtein false pair this rule exists
    // to avoid.
    expect(clustersIn(["thermal tight", "thermal light"])).toEqual([]);
  });

  it("refuses two names that differ in two positions", () => {
    expect(clustersIn(["thermal tight blue", "thermal tights red"])).toEqual(
      [],
    );
  });

  it("compares the position that differs, not the first token spelled that way", () => {
    // The rule found the odd token and then looked its VALUE up with
    // `indexOf`, which is the first position holding that token rather
    // than the position that differed: here it compared "tight" at
    // position 0 with itself, decided the two names were spellings of
    // one word, and paired two different garments.
    expect(clustersIn(["tight tight", "tight light"])).toEqual([]);
  });

  it("refuses a one-word name even when the other is it plus a marker", () => {
    // The two-token floor comes first. Without it "tight" and "tight 2"
    // read as a marker pair, and a one-word name shares too little to be
    // worth an operator's attention either way.
    expect(clustersIn(["tight", "tight 2"])).toEqual([]);
  });

  it("accepts a two-character difference inside a token and refuses three", () => {
    // The boundary itself, which "tight"/"tights" (one) and
    // "tight"/"tightest" (three) leave untested: a model number written
    // two ways is the case that lands exactly on it.
    expect(clustersIn(["elite 10", "elite 1000"])).toHaveLength(1);
    expect(clustersIn(["elite 10", "elite 10000"])).toEqual([]);
  });

  it("reads the two spellings in either order", () => {
    // The prefix question is asked both ways round, and only ONE of the
    // two runs for a given pair — the first short-circuits the second.
    // Every other test here hides that, because `clustersIn` reaches
    // each pair from both ends and a half-working rule still finds the
    // cluster on the second pass. Three names, longest first, is what
    // makes the halves visible: asking in one direction only, "elite
    // 1000" collects nothing, and the mess arrives as two overlapping
    // clusters instead of one.
    expect(clustersIn(["elite 1000", "elite 100", "elite 10"])).toEqual([
      ["elite 1000", "elite 100", "elite 10"],
    ]);
  });

  it("is not a near-miss when two names hold the very same tokens", () => {
    // Nothing disagrees, so there is no one place to judge. These are
    // the same name rather than a near-miss, and `products_brand_name`
    // already makes them impossible to store.
    expect(clustersIn(["thermal  tight", "thermal tight"])).toEqual([]);
  });
});

async function brandWith(
  name: string,
  products: readonly string[],
): Promise<string> {
  const brandId = newUlid();
  await core()
    .insert(brands)
    .values({
      id: brandId,
      name,
      normalized: normalizeIdentity(name),
    });
  for (const productName of products) {
    await core()
      .insert(productsTable)
      .values({
        id: newUlid(),
        brandId,
        name: productName,
        normalizedName: normalizeIdentity(productName),
        createdBy: newUlid(),
        createdAt: NOW,
      });
  }
  return brandId;
}

describe("the report over real rows", () => {
  beforeEach(resetSafetyTables);

  it("finds nothing in a catalogue with no near-misses", async () => {
    await brandWith("Janji", ["Thermal Tight", "Rapid Short"]);
    expect(await duplicateProducts()).toEqual([]);
  });

  it("reports a near-miss, with the brand named", async () => {
    await brandWith("Janji", ["Thermal Tight", "Thermal Tights"]);

    const found = await duplicateProducts();

    expect(found).toHaveLength(1);
    expect(found[0]?.brand).toBe("Janji");
    expect(
      found[0]?.products
        .map((p) => p.name)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["Thermal Tight", "Thermal Tights"]);
  });

  it("reports the pair, not the brand's whole catalogue", async () => {
    await brandWith("Janji", [
      "Thermal Tight",
      "Thermal Tights",
      "Rapid Short",
    ]);

    const found = await duplicateProducts();

    // The candidate is filtered to the cluster. Handing back every row
    // under the brand would tell an operator to look at products that
    // are not duplicates of anything.
    expect(found).toHaveLength(1);
    expect(found[0]?.products).toHaveLength(2);
    expect(found[0]?.products.map((p) => p.name)).not.toContain("Rapid Short");
  });

  it("does not pair the same name across two brands", async () => {
    // Two products called "Thermal Tight" from different brands are two
    // different products, and a report that pairs them is one an
    // operator stops reading.
    await brandWith("Janji", ["Thermal Tight"]);
    await brandWith("Ciele", ["Thermal Tights"]);

    expect(await duplicateProducts()).toEqual([]);
  });

  it("reports each brand's mess separately", async () => {
    await brandWith("Janji", ["Thermal Tight", "Thermal Tights"]);
    await brandWith("Ciele", ["Rapid Short", "Rapid Shorts"]);

    const found = await duplicateProducts();

    expect(found).toHaveLength(2);
    expect(
      found.map((row) => row.brand).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["Ciele", "Janji"]);
  });

  it("carries the ids, so an operator can act on the rows later", async () => {
    await brandWith("Janji", ["Thermal Tight", "Thermal Tights"]);

    const [group] = await duplicateProducts();

    // D-30 is explicit that there is no merge tooling in v1, but a report
    // that named no rows would be one nobody could act on when there is.
    expect(group?.products.every((p) => p.id.length > 0)).toBe(true);
    expect(new Set(group?.products.map((p) => p.id)).size).toBe(2);
  });

  it("respects its limit, so one firing cannot read the catalogue", async () => {
    await brandWith("Janji", ["Thermal Tight", "Thermal Tights"]);
    // A limit of one cannot produce a pair, which is the observable
    // difference between a bounded read and an unbounded one.
    expect(await duplicateProducts(1)).toEqual([]);
  });
});
