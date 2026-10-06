/**
 * Identity normalization for brands and product names (D-26/D-30): the
 * create-if-missing dedup key and the autocomplete prefix key. Casefold,
 * strip Latin diacritics, fold everything that is not a letter or digit —
 * in any script — to single spaces. "Ciele Athletics™" and
 * "ciele  athletics" land on the same row; so do "ＡＳＩＣＳ" and "asics",
 * and "ﾐｽﾞﾉ" and "ミズノ".
 *
 * **Letters in every script count (R-137).** This used to keep `[a-z0-9]`
 * and nothing else, so "ミズノ" normalized to "" and was refused as having
 * no letters. A letter is now `\p{L}`, a digit `\p{N}`.
 *
 * **Combining marks are stripped only after a Latin letter.** That is the
 * conservative split, and each half is there to avoid merging names that
 * are genuinely distinct — or splitting ones that are not:
 *
 * - On a Latin letter a mark is an accent, and brand names are typed with
 *   and without them interchangeably ("Björn Borg" off a label, "Bjorn
 *   Borg" off a keyboard). Folding them is what this function always did,
 *   so every key already stored — the curated seed included — is unchanged.
 * - Anywhere else a mark is usually part of the letter. Katakana's dakuten
 *   is what makes ズ a different letter from ス, Cyrillic й is not и, and
 *   a Devanagari vowel sign is half the syllable. Stripping those would
 *   merge different names, so they are kept and recomposed.
 *
 * The pipeline is NFKD, strip Latin marks, lowercase, NFC — and NFKD then
 * canonical composition *is* NFKC, so the compatibility forms (full-width,
 * half-width katakana, ligatures) collapse exactly as NFKC would; the strip
 * just has to happen in the decomposed middle, where the accents are
 * separate code points.
 */
export function normalizeIdentity(value: string): string {
  const folded = value
    // Strip symbol characters (™, ®, ©, emoji, …) before NFKD:
    // compatibility decomposition turns some into literal letters
    // ("™" -> "TM"), which would otherwise glue onto an adjacent word
    // instead of disappearing.
    .replaceAll(/\p{Symbol}/gu, " ")
    .normalize("NFKD")
    .replaceAll(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .toLowerCase()
    .normalize("NFC");
  // A token is a run of letters and digits, with any marks still attached
  // to them. A mark only travels with the letter before it: a stray one —
  // the variation selector left behind when an emoji is stripped — is not
  // a letter and must not make "👟️" look like a name.
  const tokens = folded.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
  return tokens.join(" ");
}
