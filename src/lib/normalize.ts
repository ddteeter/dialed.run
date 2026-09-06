/**
 * Identity normalization for brands and product names (D-26/D-30): the
 * create-if-missing dedup key and the autocomplete prefix key. Casefold,
 * strip diacritics, fold punctuation/whitespace runs to single spaces.
 * "Ciele Athletics™" and "ciele  athletics" land on the same row.
 */
export function normalizeIdentity(value: string): string {
  return value
    // Strip symbol characters (™, ®, ©, …) before NFKD: compatibility
    // decomposition turns them into literal letters ("™" -> "TM"), which
    // would otherwise glue onto an adjacent word instead of disappearing.
    .replaceAll(/\p{Symbol}/gu, " ")
    .normalize("NFKD")
    .replaceAll(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}
