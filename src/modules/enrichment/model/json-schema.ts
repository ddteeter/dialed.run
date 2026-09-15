import { z } from "zod";

/**
 * The JSON Schema a structured-output request carries, derived from the zod
 * contract rather than written beside it.
 *
 * **Derived, because a hand-written copy is a rival truth** (CLAUDE.md
 * §Derive, don't mirror). A field added to `extractedProductSchema` and
 * forgotten here would be one the model is never asked for, silently, with
 * nothing failing — the exact shape of drift that section describes.
 * `z.toJSONSchema` does the conversion; what follows is the part it cannot
 * know about, which is the provider's dialect.
 */

/**
 * Strict structured output requires **every** property in `required` and
 * `additionalProperties: false` — a provider rejects the request otherwise.
 * Our fields are all optional, which is the whole point of an extraction
 * contract, so "optional" has to be re-expressed as "required, and allowed
 * to be null".
 *
 * That is a translation, not a second schema: the names, the nesting and
 * the value types still come from zod. What the model returns is parsed
 * back through `extractedProductSchema`, with nulls dropped first, so the
 * contract remains the only definition of what a valid extraction is.
 */
export function toStrictSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return schema;

  const { properties } = schema;
  if (!isRecord(properties)) return mapValues(schema, toStrictSchema);

  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const strict = toStrictSchema(value);
    rewritten[key] = isRequired(schema, key) ? strict : nullable(strict);
  }
  return {
    ...schema,
    properties: rewritten,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function nullable(schema: unknown): unknown {
  return { anyOf: [schema, { type: "null" }] };
}

/**
 * The model's answer with every null dropped, so the contract can parse it.
 *
 * `null` is how the request asked the model to say "not on the page" — zod
 * says the same thing by the key being absent, and `.optional()` does not
 * accept null. Without this every unfound field fails the parse and a good
 * extraction is thrown away whole.
 */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutNulls(item));
  if (!isRecord(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null) continue;
    kept[key] = withoutNulls(item);
  }
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the schema already demanded this key.
 *
 * Written as one total expression rather than "coerce `required` to an
 * array, then look in it": the empty-array fallback that needs is
 * indistinguishable from any other array missing the key, so no input can
 * tell the two apart and no test can pin it.
 */
function isRequired(schema: Record<string, unknown>, key: string): boolean {
  const { required } = schema;
  return Array.isArray(required) && required.includes(key);
}

function mapValues(
  record: Record<string, unknown>,
  map: (value: unknown) => unknown,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) mapped[key] = map(value);
  return mapped;
}

/**
The strict JSON Schema for a zod schema — the two steps above, in order.
*/
export function strictSchemaFor(schema: z.ZodType): unknown {
  return toStrictSchema(z.toJSONSchema(schema));
}
