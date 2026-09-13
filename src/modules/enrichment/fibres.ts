/**
 * The fibres a composition can name.
 *
 * **This is the discriminator, and it replaced a cue word.** Requiring a
 * percentage alone turns "20% off today" into a fibre called `off`; requiring
 * a preceding cue ("Fabric:", "Composition:") fails on how shops actually
 * write it — `composition :`, `PacerWeave™ body:`, a bare `<strong>` fabric
 * name, or nothing at all. A percentage *beside a fibre we know* is the test
 * that survives both, measured against 14 real pages.
 *
 * **A data table, and deliberately a code change to extend.** The list will
 * be wrong — proprietary fibres like `Primeflex` are not on it and cannot be
 * — so the model rung records unrecognised fibres as candidates and a human
 * promotes them here. Keeping promotion in version control is the point: the
 * vocabulary is reviewed, and every addition improves every stored snapshot
 * on the next `reextract` (D-31).
 *
 * Brand names that have become fibre names in ordinary use — lycra, cordura,
 * tencel — are included, because that is how product pages write them.
 */
const FIBRES = [
  "acrylic",
  "alpaca",
  "bamboo",
  "cashmere",
  "cordura",
  "cotton",
  "cupro",
  "down",
  "elastane",
  "hemp",
  "linen",
  "lycra",
  "lyocell",
  "merino",
  "modal",
  "mohair",
  "nylon",
  "polyamide",
  "polyester",
  "polypropylene",
  "polyurethane",
  "rayon",
  "silk",
  "spandex",
  "tencel",
  "viscose",
  "wool",
] as const;

const KNOWN = new Set<string>(FIBRES);

/**
 * Does this material name a fibre we know?
 *
 * Matched on any word, not the whole string, because a fibre arrives with
 * qualifiers attached: "recycled polyester", "merino wool", "17.5μ merino
 * wool". The qualifier is worth keeping in the material name — it is what a
 * runner reads — so it is kept and the *presence* of a known word is what
 * makes it a composition rather than a sale.
 */
export function isFibre(material: string): boolean {
  // Letter runs matched rather than split on the gaps between them: `split`
  // needs a `+` whose absence only ever produces empty strings nothing
  // matches, which is a mutant no input can distinguish. `matchAll` yields
  // the words directly and never returns null.
  for (const [word] of material.toLowerCase().matchAll(/\p{Letter}+/gu)) {
    if (KNOWN.has(word)) return true;
  }
  return false;
}

/**
Every fibre the vocabulary knows, for the candidate check in the model rung.
*/
export function knownFibres(): readonly string[] {
  return FIBRES;
}
