import type { z } from "zod";

import { fabricPartSchema, type FabricComposition } from "../../lib/contracts";
import { isFibre } from "./fibres";
import { withoutCode } from "./html";

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
 * HTML entities, removed before anything reads the text.
 *
 * A description arrives with `&amp;` in it — often double-encoded, as
 * `&amp;amp;` — and a letter-run match turns that into a fibre called "amp".
 *
 * Decoded before stripping, and that order is the point: stripping
 * `&amp;amp;` twice leaves a bare `amp;`, because the second pass has no `&`
 * left to match. Decoding to `&` first collapses the nesting, and whatever
 * entities remain are then removed.
 *
 * `\u0026` is the same character arriving through JSON, which reaches this
 * from product data embedded in an *attribute* — a value containing `>`
 * spills past naive tag splitting and lands in the text. Stripping scripts
 * does not catch it, because it was never in a script.
 */
const AMPERSAND = /&amp;|\\u0026/giu;
const ENTITY = /&#?[a-z0-9]{1,8};/giu;

/**
 * A text node as a reader would see it: entities resolved, whitespace
 * collapsed.
 *
 * Decoded until it stops changing rather than a fixed number of passes. The
 * nesting is genuinely three deep in the wild — `\u0026amp;amp;` unwraps to
 * `&amp;amp;`, then `&amp;`, then `&` — and stopping one short leaves an
 * entity the strip below eats, taking the separator between two fibres with
 * it and merging them into one nonsense material.
 */
function readableText(raw: string): string {
  // Until it stops changing, with no pass counter. Every decode strictly
  // shortens the string — `&amp;` and `\u0026` are both longer than the `&`
  // they become — so this terminates, and a bound would only be a number
  // nothing could distinguish from a larger one.
  let decoded = raw;
  let next = decoded.replaceAll(AMPERSAND, "&");
  // Compared against the *result* rather than a seeded previous value: any
  // seed is a string the first comparison can never depend on, which is a
  // mutant nothing distinguishes.
  while (next !== decoded) {
    decoded = next;
    next = decoded.replaceAll(AMPERSAND, "&");
  }
  return decoded.replaceAll(ENTITY, " ").replaceAll(/\s+/gu, " ").trim();
}

/**
 * Words that are never part of a fibre name, and the cap on how long one is.
 *
 * A material is "merino wool" or "recycled polyester" — two or three words.
 * Unbounded, a meta description yields a fibre called "a lightweight woven
 * fabric places a merino wool inner face against the skin": a sentence that
 * happens to contain a fibre.
 */
// "and" is deliberately absent: it separates materials ("70% merino and 30%
// nylon"), so it is consumed before this filter ever sees it. Listing it here
// would be a rule that cannot fire.
const STOPWORD_LIST = ["a", "an", "from", "in", "of", "the", "with"] as const;
const STOPWORDS = new Set<string>(STOPWORD_LIST);

/**
Exported so every entry is covered by a case rather than the list as a whole.
*/
export function stopwords(): readonly string[] {
  return STOPWORD_LIST;
}
const MAX_MATERIAL_WORDS = 3;

/**
 * The fibre name inside a chunk: the last known fibre word, plus up to two
 * words in front of it.
 *
 * Anchored to the *end* because qualifiers precede a fibre — "recycled
 * polyester", "17.5μ merino wool" — and never follow it. Single characters
 * are dropped, which is what removes the stray micron grade.
 */
function materialName(words: readonly string[]): string | undefined {
  // Scanned forward, keeping the last hit, rather than backward from the
  // end: a backward loop needs `words[index]`, and the undefined that
  // indexing forces is a branch the loop bounds already make unreachable.
  let last = -1;
  for (const [index, word] of words.entries()) {
    if (isFibre(word)) last = index;
  }
  // No `last === -1` guard: the slice below is empty for a negative index,
  // so the empty-name check already answers it. Two guards where one fires
  // means neither can be killed.
  const name = words
    .slice(Math.max(0, last - MAX_MATERIAL_WORDS + 1), last + 1)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .join(" ");
  return name === "" ? undefined : name;
}

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
    const words: string[] = [];
    for (const [word] of chunk.toLowerCase().matchAll(WORDS)) words.push(word);
    // A percentage beside words is not a composition — "20% off today" and
    // "Save 15%" are the common case on a product page. A known fibre is
    // what makes it a fact rather than a sale, and it is why this no longer
    // invents a fibre from "Made with 100% care in Portugal".
    const material = materialName(words);
    if (material === undefined) continue;
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
  const verbatim = readableText(raw);
  // No early bail on "has no percentage": since a run with no materials now
  // returns undefined anyway, the guard could not change an answer — it only
  // saved work on a string the loop below dismisses in a pass. Dead code in
  // a parser is worse than the microseconds.

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

  // No parts means no fibre was named, which means this was never a
  // composition — a stray percentage in marketing copy. Returning a verbatim
  // with no parts would write that text into the column and, under
  // fill-only-what-is-blank, block a later rung that had the real thing.
  return parts.length === 0 ? undefined : { verbatim, parts };
}

/**
 * The composition on a page, wherever a shop chose to put it.
 *
 * Measured against 14 real pages: composition is in metafields rendered into
 * a "Specs" panel, in description prose, in `<meta name="description">`, and
 * in JSON-LD — never reliably in one field. So this searches the page's text
 * nodes rather than reading a payload.
 *
 * **A text node is the right granularity** because a composition is written
 * as one: `47% 17.5μ merino wool, 38% 37.5® nylon, 15% nylon` arrives whole,
 * and so does `Toray Primeflex™: 100% polyester`. Splitting finer would cut
 * a composition in half; coarser would glue a sale onto it.
 *
 * The first node that parses wins. A page can mention fabric more than once
 * — related products, variant blurbs — and the first is nearest the product
 * being described.
 */
export function findComposition(html: string): FabricComposition | undefined {
  for (const node of withoutCode(html).split(/<[^>]{0,2000}>/gu)) {
    const composition = parseComposition(node);
    if (composition !== undefined) return composition;
  }
  return undefined;
}
