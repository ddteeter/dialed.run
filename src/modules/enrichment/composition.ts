import type { z } from "zod";

import { fabricPartSchema, type FabricComposition } from "../../lib/contracts";

/**
Derived from the schema rather than restated (CLAUDE.md §Derive, don't mirror).
*/
type FabricPart = z.infer<typeof fabricPartSchema>;

/**
 * Fabric composition out of a product page's prose.
 *
 * This is the field the whole lane exists for — it is what the Call will
 * reason about — and it is never a tidy attribute. It lives in a description
 * blob, written by whoever built the shop, in any of a dozen shapes:
 *
 *     88% polyester, 12% elastane
 *     Polyester 88% / Elastane 12%
 *     100% Merino Wool
 *     Body: 100% recycled polyester; Liner: 88% polyester, 12% spandex
 *
 * **`verbatim` is always kept, and it is the part that matters most.** The
 * parse is a convenience for filtering and for the Call; the original string
 * is what a runner reads and what a later, better parser gets to re-run over
 * (D-31). Storing only the parse would throw away the evidence.
 */

/**
 * A labeled section: "Body:", "Shell:", "Lining:". Anchored to a separator
 * so a stray colon mid-sentence does not start one.
 *
 * Every quantifier is bounded and none is lazy: `\s*` either side of a lazy
 * run backtracks super-linearly, and it is unnecessary here because the input
 * has had its whitespace collapsed to single spaces before this ever runs.
 */
const LABEL = /(?:^|[;,.]) ?(?<label>[A-Za-z][A-Za-z /&'-]{0,29}): ?/gu;

/**
Percentage-and-material, either way round: "88% nylon" or "nylon 88%".
*/
const PERCENTAGE = /(\d{1,3}(?:\.\d+)?)\s?%/u;

/**
Runs of letters — the fibre name, once the numbers are set aside.
*/
const WORDS = /[\p{Letter}'-]+/gu;

/**
 * What separates one material from the next inside a section.
 *
 * A character class rather than an alternation wrapped in `\s*` on both
 * sides: that shape backtracks super-linearly, and the surrounding
 * whitespace is trimmed off each chunk anyway.
 */
const BETWEEN_MATERIALS = /[,/&+]|\band\b/u;

/**
 * Materials in one section.
 *
 * **A percentage is required**, and that is a deliberate loss. Without one,
 * "88% polyester, imported" contributes "imported" as a material, and a
 * description is full of words that are not fabrics. Anything dropped here is
 * still in `verbatim`, so the cost is a thinner parse rather than lost data —
 * where the opposite mistake puts a fiction in a typed column.
 */
function materialsIn(section: string): FabricPart["materials"] {
  const materials: FabricPart["materials"] = [];
  for (const chunk of section.split(BETWEEN_MATERIALS)) {
    const pct = PERCENTAGE.exec(chunk)?.[1];
    if (pct === undefined) continue;
    // The name is every letter-run joined, rather than the chunk with the
    // non-letters stripped out. Same answer, and it needs no separate pass
    // to collapse what the stripping left behind.
    const material = (chunk.match(WORDS) ?? []).join(" ").toLowerCase();
    if (material === "") continue;
    materials.push({ material, pct: Number(pct) });
  }
  return materials;
}

/**
 * Parse a composition string, or decide it is not one.
 *
 * Returns `null` when no percentage appears anywhere: a page is mostly prose,
 * and "soft merino feel" is marketing rather than a composition. Requiring a
 * number is the cheapest signal that someone was stating a fact.
 */
export function parseComposition(raw: string): FabricComposition | undefined {
  const verbatim = raw.replaceAll(/\s+/gu, " ").trim();
  // No `verbatim === ""` clause: an empty string has no percentage either,
  // so it is already covered by the test below.
  if (!PERCENTAGE.test(verbatim)) return undefined;

  // `split` with a capturing group hands back [before, label, section,
  // label, section, …] — the section boundaries fall out of it, with no
  // index arithmetic and no second pass over the matches.
  // `split` with a capturing group hands back [before, label, section,
  // label, section, …]. Walked with the iterator rather than by index: every
  // `pieces[i]` needs an undefined check that the loop bounds already make
  // unreachable, and an unreachable branch is a mutant nobody can kill.
  const pieces = verbatim.split(LABEL);
  const parts: FabricPart[] = [];
  const labelled = pieces.slice(1);

  if (labelled.length === 0) {
    // No labels: one unlabeled part, which is the common case and also what
    // an unlabeled multi-fabric string degrades to.
    const materials = materialsIn(verbatim);
    if (materials.length > 0) parts.push({ materials });
  } else {
    /**
     * **Equivalent mutant, and the proof is the shape of `split`.**
     *
     * `String.split` with a capturing group always returns
     * [before, capture, text, capture, text, …]. Dropping the first element
     * leaves a list that starts with a capture and alternates, so index 0 is
     * always a label, always even, and always assigns this variable before
     * any odd index reads it. No input reaches the seed — the loop cannot
     * begin on a section.
     *
     * Restructuring was tried four ways and each only moves the problem:
     * an index walk, `at(index + 1)`, filter-and-zip, and push-then-fill all
     * trade this seed for an `undefined` check that is unreachable for the
     * same reason. TypeScript cannot express "even length, alternating", so
     * something unobservable has to absorb that fact.
     */
    // Stryker disable next-line StringLiteral
    let pendingLabel = "";
    for (const [index, piece] of labelled.entries()) {
      if (index % 2 === 0) {
        pendingLabel = piece.trim();
        continue;
      }
      const materials = materialsIn(piece);
      if (materials.length > 0) parts.push({ part: pendingLabel, materials });
    }
  }

  return parts.length === 0 ? { verbatim } : { verbatim, parts };
}
