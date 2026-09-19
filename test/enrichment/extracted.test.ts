import { describe, expect, it } from "vitest";

import { someExtracted, textAt } from "../../src/modules/enrichment/extracted";

describe("someExtracted", () => {
  it("passes every field through", () => {
    // Listed exhaustively on purpose. The helper exists so a field added to
    // ExtractedProduct reaches both rungs; a field it silently drops is one
    // the ladder never sees, from any rung, with nothing failing.
    const all = {
      name: "Rover Half-Zip",
      brand: "Janji",
      categoryHint: "Tops",
      imageUrl: "https://cdn.example.com/rover.jpg",
      weight: "mid",
      fabric: "synthetic",
      windResistant: true,
      waterResistant: true,
      fabricComposition: { verbatim: "100% merino" },
      extras: { sku: "RHZ-1" },
    } as const;

    expect(someExtracted(all)).toStrictEqual(all);
  });

  it("keeps a field that is false", () => {
    // The one that a truthiness check gets wrong. "This garment is not wind
    // resistant" is a finding; dropping it leaves the column null, which
    // means "nobody looked" — and under fill-only-what-is-blank a later run
    // would then overwrite it.
    expect(someExtracted({ windResistant: false })).toStrictEqual({
      windResistant: false,
    });
    expect(someExtracted({ waterResistant: false })).toStrictEqual({
      waterResistant: false,
    });
  });

  it("drops the fields that were not found", () => {
    expect(
      someExtracted({ name: "Rover Half-Zip", brand: undefined }),
    ).toStrictEqual({ name: "Rover Half-Zip" });
  });

  it("says nothing when a rung found nothing", () => {
    // Not an empty object: the ladder reads that as a rung that succeeded
    // and stops trying the next one.
    expect(someExtracted({})).toBeUndefined();
    expect(someExtracted({ name: undefined })).toBeUndefined();
  });
});

describe("textAt", () => {
  it("reads a string field off an object", () => {
    expect(textAt({ title: "Rover Half-Zip" }, "title")).toBe("Rover Half-Zip");
  });

  it("ignores a field that is not a string", () => {
    // The per-field rule: a shop publishing `title: 42` loses its title and
    // nothing else.
    expect(textAt({ title: 42, vendor: "Janji" }, "title")).toBeUndefined();
    expect(textAt({ title: 42, vendor: "Janji" }, "vendor")).toBe("Janji");
  });

  it("ignores a field that is absent", () => {
    expect(textAt({}, "title")).toBeUndefined();
  });

  it("is not fooled by null", () => {
    // `typeof null === "object"`, so a check that stops at the typeof reads
    // a property off null and throws — losing the rung to a payload that
    // merely had a hole in it.
    //
    // Parsed rather than written: `unicorn/no-null` forbids the literal, and
    // this is where the value actually comes from anyway — a page's JSON.
    const fromJson: unknown = JSON.parse("null");
    expect(textAt(fromJson, "title")).toBeUndefined();
  });

  it("ignores a source that is not an object at all", () => {
    expect(textAt(undefined, "title")).toBeUndefined();
    expect(textAt("a string", "title")).toBeUndefined();
    expect(textAt(42, "title")).toBeUndefined();
  });
});
