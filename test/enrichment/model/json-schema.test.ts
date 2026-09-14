import { describe, expect, it } from "vitest";
import { z } from "zod";

import { extractedProductSchema } from "../../../src/lib/contracts";
import {
  strictSchemaFor,
  toStrictSchema,
  withoutNulls,
} from "../../../src/modules/enrichment/model/json-schema";

/**
 * The translation from the zod contract to a provider's strict dialect.
 * Every case here is a shape a provider rejects, or one that rejecting
 * would lose — both were measured against the real API before they were
 * written down.
 */

/**
 * A zod schema, converted and then made strict — the two steps every case
 * below takes, named so each reads as one call rather than three.
 */
function strictly(schema: z.ZodType): unknown {
  return toStrictSchema(z.toJSONSchema(schema));
}

/**
 * Values carrying `null`, built the way they actually arrive: parsed out of
 * a model's JSON response. The repo writes no `null` literal, and here that
 * restriction makes the test more faithful rather than less.
 */
function fromJson(json: string): unknown {
  return JSON.parse(json);
}

function propertyOf(schema: unknown, key: string): unknown {
  return propertiesOf(schema)[key];
}

function propertiesOf(schema: unknown): Record<string, unknown> {
  const asRecord = schema as { properties?: Record<string, unknown> };
  return asRecord.properties ?? {};
}

function requiredOf(schema: unknown): string[] {
  return (schema as { required?: string[] }).required ?? [];
}

describe("toStrictSchema", () => {
  it("requires every property, because strict mode refuses a partial one", () => {
    const both = z.object({ a: z.string(), b: z.string().optional() });
    expect(requiredOf(z.toJSONSchema(both))).toStrictEqual(["a"]);
    expect(requiredOf(strictly(both))).toStrictEqual(["a", "b"]);
  });

  it("lets an optional property be null, since it is now required", () => {
    // The other half of the same trade: a field the page does not state
    // has to have a way to say so, and `required` took the absent one away.
    const strict = strictly(z.object({ b: z.string().optional() }));
    expect(propertyOf(strict, "b")).toStrictEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("leaves a genuinely required property alone, null included", () => {
    const strict = strictly(z.object({ a: z.string() }));
    expect(propertyOf(strict, "a")).toStrictEqual({ type: "string" });
  });

  it("closes every object to extra properties", () => {
    const strict = toStrictSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
    expect(strict).toMatchObject({ additionalProperties: false });
  });

  it("reaches a nested object, not just the top level", () => {
    const nested = z.object({ outer: z.object({ inner: z.string().optional() }) });
    const strict = strictly(nested);
    const outer = propertyOf(strict, "outer");
    expect(requiredOf(outer)).toStrictEqual(["inner"]);
    expect(propertyOf(outer, "inner")).toStrictEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("reaches an object inside an array's items", () => {
    // `fabricComposition.parts[].part` is optional and lives exactly here.
    const item = z.object({ x: z.string().optional() });
    const listed = z.object({ list: z.array(item) });
    const strict = strictly(listed);
    const items = (propertyOf(strict, "list") as { items?: unknown }).items;
    expect(requiredOf(items)).toStrictEqual(["x"]);
  });

  it("passes a schema with no properties through untouched", () => {
    expect(toStrictSchema({ type: "string" })).toStrictEqual({
      type: "string",
    });
    expect(toStrictSchema("not a schema")).toBe("not a schema");
  });

  it("does not mistake an array for an object with properties", () => {
    expect(toStrictSchema([1, 2])).toStrictEqual([1, 2]);
  });
});

/**
What the model is asked for: the contract minus `extras`. See `openrouter.ts`.
*/
const ASKED_FOR = extractedProductSchema.omit({ extras: true });

describe("strictSchemaFor", () => {
  it("derives the contract's own field names, so a new field is asked for", () => {
    // The reason this is derived and not written out: a field added to the
    // contract and forgotten here is one the model is never asked for, and
    // nothing fails.
    const schema = strictSchemaFor(ASKED_FOR);
    expect(requiredOf(schema)).toStrictEqual(Object.keys(ASKED_FOR.shape));
  });

  it("leaves out `extras`, which a provider refuses and a model should not invent", () => {
    // Measured: `z.record` converts to `propertyNames`, and OpenAI's strict
    // mode answers `400 invalid_json_schema`. It is also the field the
    // deterministic rungs keep raw evidence in.
    expect(requiredOf(strictSchemaFor(ASKED_FOR))).not.toContain("extras");
    expect(Object.keys(extractedProductSchema.shape)).toContain("extras");
  });

  it("keeps the enums the contract declares", () => {
    const schema = strictSchemaFor(ASKED_FOR);
    expect(propertyOf(schema, "weight")).toStrictEqual({
      anyOf: [
        { type: "string", enum: ["light", "mid", "heavy"] },
        { type: "null" },
      ],
    });
  });
});

describe("withoutNulls", () => {
  it("drops a null so an optional field can parse as absent", () => {
    expect(withoutNulls(fromJson('{"a":null,"b":"x"}'))).toStrictEqual({
      b: "x",
    });
  });

  it("drops one nested inside an object or an array", () => {
    const nested = fromJson('{"a":{"b":null,"c":1},"d":[{"e":null,"f":2}]}');
    expect(withoutNulls(nested)).toStrictEqual({ a: { c: 1 }, d: [{ f: 2 }] });
  });

  it("keeps false and zero, which are answers and not absences", () => {
    // The bug this exists to not have: `windResistant: false` is a finding.
    expect(withoutNulls({ a: false, b: 0, c: "" })).toStrictEqual({
      a: false,
      b: 0,
      c: "",
    });
  });

  it("returns a non-object unchanged, null included", () => {
    expect(withoutNulls("x")).toBe("x");
    expect(withoutNulls(fromJson("null"))).toBeNull();
  });
});
