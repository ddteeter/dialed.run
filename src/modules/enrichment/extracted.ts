import { z } from "zod";

import {
  extractedProductSchema,
  type ExtractedProduct,
} from "../../lib/contracts";

/**
 * Reading loose data into an `ExtractedProduct`, and assembling what a rung
 * found.
 */

/**
 * One string field off an object of unknown shape.
 *
 * **Per field, deliberately.** Every rung reads JSON from a page we do not
 * control. Parsing a node as one object means a shop publishing `title: 42`
 * loses its vendor and description too; asking for one field at a time drops
 * the bad value and keeps the rest.
 */
export function textAt(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  return z.string().safeParse(Reflect.get(source, key)).data;
}

/**
 * The fields an `ExtractedProduct` can carry, read from the schema rather
 * than listed again here.
 *
 * Listing them was ten near-identical lines, and worse, a second copy of a
 * fact the contract already states — so a field added there and forgotten
 * here would be one the ladder silently never passes on, from any rung, with
 * nothing failing (CLAUDE.md §Derive, don't mirror).
 */
const FIELDS = Object.keys(extractedProductSchema.shape);

/**
 * Assembling what a rung found.
 *
 * A rung that found nothing must say *nothing* rather than hand the ladder
 * an empty object — an empty object reads as a rung that succeeded, and
 * stops the next one being tried.
 */
export function someExtracted(
  fields: Readonly<ExtractedProduct>,
): ExtractedProduct | undefined {
  const found: ExtractedProduct = {};
  for (const key of FIELDS) {
    const value: unknown = Reflect.get(fields, key);
    // `!== undefined` rather than truthiness: `windResistant: false` is a
    // finding, and dropping it leaves a column that reads as "nobody looked".
    if (value !== undefined) Reflect.set(found, key, value);
  }
  return Object.keys(found).length > 0 ? found : undefined;
}
