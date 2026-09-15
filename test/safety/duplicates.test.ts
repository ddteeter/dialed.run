import { describe, expect, it } from "vitest";

import { clustersIn } from "../../src/modules/safety/duplicates";

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
