/**
 * The fibres a composition names — **taught to the model, not enforced by a
 * parser** (owner, 2026-09-14).
 *
 * It used to be a gate. The composition parser accepted a percentage only
 * when one of its words was on this list, which is what stopped "20% off
 * today" becoming a fibre called `off`. The gate went with the prose search
 * it was built for, and the measurement said why it could not stay: on a
 * *declared* field it silently dropped `100% Primeflex`, `88% PA 12% EL`
 * and `Shell: 100% Coreloft`, because a list of fibres cannot contain the
 * trade names shops invent. The parser itself followed — composition has
 * one source now, and it is the model.
 *
 * As a hint it does the opposite job, and a job the eval showed is needed:
 * models called `Coreloft™ 80`, `Arato™ 15`, `2:09 Mesh` and `decoration`
 * materials. Telling one what a fibre *is* costs a few dozen tokens and
 * addresses that directly, where a gate could only discard the answer
 * afterwards.
 *
 * So this list is now wrong in a harmless direction. Missing a fibre used
 * to mean losing a composition; now it means the prompt's examples are a
 * little less complete.
 *
 * Brand names that have become fibre names in ordinary use — lycra,
 * cordura, tencel — are included, because that is how product pages write
 * them.
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

/**
The vocabulary, for the prompt and for the eval's review column.
*/
export function knownFibres(): readonly string[] {
  return FIBRES;
}
