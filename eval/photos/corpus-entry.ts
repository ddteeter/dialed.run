/**
 * The shape of one photo-corpus row, and the positional builder for it.
 *
 * Split out of `corpus.ts` so that file and `corpus-data.ts` can both depend
 * on this without depending on each other. `corpus-data.ts` needs `photo`
 * and `CorpusEntry` to build the table; `corpus.ts` needs `CORPUS` (the
 * table) to validate it. Those two used to import from one another directly,
 * which is a circular dependency — dependency-cruiser's `no-circular` rule
 * catches it repo-wide, `eval/` included.
 */
import { z } from "zod";

export const corpusEntrySchema = z.object({
  /**
  File name inside `eval/photos/corpus/`.
  */
  file: z.string(),
  /**
   * How much skin is in frame, the axis the false positive lives on.
   * Ordered, so the report can show the score climbing (or not) along it.
   */
  exposure: z.enum(["covered", "arms", "midriff", "shirtless"]),
  framing: z.enum(["flat_lay", "mirror", "full_body", "action"]),
  /**
  What a reader needs to judge a surprising score without the photo.
  */
  note: z.string(),
});

export type CorpusEntry = z.infer<typeof corpusEntrySchema>;

/**
 * One corpus row.
 *
 * Positional behind a typed signature, rather than an object literal per
 * entry: with four fields the repeated key names were most of the table's
 * bytes and the clone detector read the buckets as copies of each other.
 * The argument order is the same as the type's field order, and the
 * compiler rejects a transposition of the two enums.
 */
export function photo(
  file: string,
  exposure: CorpusEntry["exposure"],
  framing: CorpusEntry["framing"],
  note: string,
): CorpusEntry {
  return { file, exposure, framing, note };
}
