import type { z } from "zod";

/**
 * A serialization adapter for an `Error` that must keep more than its
 * message across a server function's response, as
 * `createSerializationAdapter` takes one (`src/start.ts` registers them).
 *
 * TanStack Start serializes a thrown `Error` with its `message` alone
 * (router-core's `ShallowErrorPlugin`). An `Error` whose own properties
 * parse through `schema` goes instead as exactly what the schema reads,
 * every other property stripped, and comes back as an `Error` carrying
 * it. Anything else is not matched, and keeps the framework's treatment.
 *
 * The auth signals (`lib/auth-signal`, design 133) and field refusals
 * (`lib/field-refusal`, design 171) are the two uses. The key is the wire
 * name: a tab from the last deploy reads this one's answers by it.
 */
export function wireErrorAdapter<Wire extends { message: string }>(
  key: string,
  schema: z.ZodType<Wire>,
) {
  return {
    key,
    test: (value: unknown): value is Error & Wire =>
      value instanceof Error && schema.safeParse(value).success,
    toSerializable: (error: Error & Wire): Wire => schema.parse(error),
    fromSerializable: (wire: Wire): Error & Wire =>
      Object.assign(new Error(wire.message), wire),
  };
}
