/**
 * Identity normalization for brands and product names (D-26/D-30): the
 * create-if-missing dedup key and the autocomplete prefix key. Casefold,
 * strip optional diacritics, fold everything that is not a letter or digit —
 * in any script — to single spaces. "Ciele Athletics™" and
 * "ciele  athletics" land on the same row; so do "ＡＳＩＣＳ" and "asics",
 * and "ﾐｽﾞﾉ" and "ミズノ".
 *
 * **Letters in every script count (R-137).** This used to keep `[a-z0-9]`
 * and nothing else, so "ミズノ" normalized to "" and was refused as having
 * no letters. A letter is now `\p{L}`, a digit `\p{N}`.
 *
 * **Some marks are always noise, some are accents, the rest are letters.**
 * Each rule below exists to avoid merging names that are genuinely
 * distinct — or splitting ones that are not:
 *
 * - **Invisible marks go everywhere.** A variation selector (U+FE0E/FE0F
 *   and the supplementary range) and an enclosing mark (the keycap U+20E3,
 *   the enclosing circle) change how a glyph is drawn, never which letter
 *   it is. Kept, "ミズノ" followed by U+FE0E was a second key that looked
 *   identical to "ミズノ".
 * - **Optional accents are folded, in the scripts that write them as
 *   optional.** On a Latin or Greek letter a mark is an accent, and names
 *   are typed with and without them interchangeably ("Björn Borg" off a
 *   label, "Bjorn Borg" off a keyboard; "Αθήνα" and the all-caps "ΑΘΗΝΑ",
 *   which drops its tonos). Hebrew points (niqqud, cantillation) and
 *   Arabic harakat are vowel and reading aids most text omits, so they are
 *   folded too — by code point range, because they are marks only there.
 *   For Latin this is what the function always did, so every key already
 *   stored — the curated seed included — is unchanged.
 * - **Anywhere else a mark is part of the letter.** Katakana's dakuten is
 *   what makes ズ a different letter from ス, Cyrillic й is not и, and a
 *   Devanagari vowel sign is half the syllable. Stripping those would
 *   merge different names, so they are kept and recomposed. (That is also
 *   why Cyrillic ё is not folded to е: it is the same mechanism as й. The
 *   splits this leaves — ё/е, Turkish ı/i, ø/æ/ł — are R-139.)
 *
 * Then two case folds `toLowerCase` does not do: ß is "ss" (so "Straße"
 * meets "STRASSE", which is how it is written in capitals), and final
 * sigma ς is σ (lowercasing picks ς only for a word-final capital Σ, so a
 * name typed in lowercase and one typed in capitals otherwise disagree).
 *
 * The pipeline is NFKD, strip marks, lowercase, NFC — and NFKD then
 * canonical composition *is* NFKC, so the compatibility forms (full-width,
 * half-width katakana, ligatures) collapse exactly as NFKC would; the strip
 * just has to happen in the decomposed middle, where the accents are
 * separate code points.
 *
 * Stryker cannot mutate the mark-stripping regexes (its regex parser does
 * not read `\p{Script=…}` or `\p{Variation_Selector}`), so the tests in
 * `test/products/normalize.test.ts` stand in for those mutants by hand:
 * stacked marks for `+`, one case per script for each class.
 */
export function normalizeIdentity(value: string): string {
  const folded = value
    // Strip symbol characters (™, ®, ©, emoji, …) before NFKD:
    // compatibility decomposition turns some into literal letters
    // ("™" -> "TM"), which would otherwise glue onto an adjacent word
    // instead of disappearing.
    .replaceAll(/\p{Symbol}/gu, " ")
    .normalize("NFKD")
    .replaceAll(/[\p{Variation_Selector}\p{Me}]/gu, "")
    .replaceAll(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, "$1")
    // Hebrew points and Arabic harakat. The Hebrew block's U+05BE, U+05C0,
    // U+05C3 and U+05C6 are punctuation, not marks, and are left for the
    // tokenizer to turn into a space.
    .replaceAll(
      /[\u{591}-\u{5BD}\u{5BF}\u{5C1}\u{5C2}\u{5C4}\u{5C5}\u{5C7}\u{64B}-\u{65F}\u{670}]/gu,
      "",
    )
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ")
    .normalize("NFC");
  // A token is a run of letters and digits, with any marks still attached
  // to them. A mark only travels with the letter before it: a stray one is
  // not a letter and must not make a lone combining accent look like a name.
  const tokens = folded.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
  return tokens.join(" ");
}
