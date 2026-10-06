import { describe, expect, it } from "vitest";

import { normalizeIdentity } from "../../src/lib/normalize";
import { CURATED_BRANDS } from "../../src/modules/products/seed-brands";

describe("normalizeIdentity", () => {
  it("casefolds and strips punctuation/whitespace runs", () => {
    expect(normalizeIdentity("Ciele Athletics™")).toBe("ciele athletics");
    expect(normalizeIdentity("ciele  athletics")).toBe("ciele athletics");
  });

  it("replaces a symbol with a space, not nothing", () => {
    // The distinction only shows when the symbol sits *between* words —
    // every other test puts it at the end, where trimming hides the
    // difference. Two brands whose names differ only by a separator must
    // not collapse onto one canonical row.
    //
    // Found by mutation testing: `.replaceAll(/\p{Symbol}/gu, " ")` -> `""`
    // survived the whole suite.
    expect(normalizeIdentity("Nike®Air")).toBe("nike air");
    expect(normalizeIdentity("Nike Air")).toBe("nike air");
    expect(normalizeIdentity("NikeAir")).toBe("nikeair");
  });

  it("strips diacritics", () => {
    expect(normalizeIdentity("Björn Borg")).toBe("bjorn borg");
  });

  it("collapses mixed punctuation to single spaces and trims", () => {
    expect(normalizeIdentity("  On-Running!!  ")).toBe("on running");
  });

  it("dedup collisions land on the same normalized key", () => {
    const variants = ["Janji", " janji ", "JANJI", "Janji™"];
    const normalized = new Set(
      variants.map((value) => normalizeIdentity(value)),
    );
    expect(normalized.size).toBe(1);
  });

  it("returns empty string for input with no letters or digits", () => {
    expect(normalizeIdentity("!!!")).toBe("");
  });
});

/**
 * R-137: a letter is a letter in any script. Before this, "ミズノ"
 * normalized to "" and a confirmed runner saving it was told the brand had
 * no letters in it.
 */
describe("normalizeIdentity: names in any script", () => {
  it("keeps Japanese, Korean and Cyrillic letters", () => {
    expect(normalizeIdentity("ミズノ")).toBe("ミズノ");
    expect(normalizeIdentity("뉴발란스")).toBe("뉴발란스");
    expect(normalizeIdentity("Сокол Бег")).toBe("сокол бег");
  });

  it("keeps a mark that is part of a non-Latin letter", () => {
    // The dakuten is what makes ズ a different letter from ス, and й a
    // different letter from и. Stripping marks everywhere — which is what
    // stripping Latin accents used to do — would merge distinct names.
    expect(normalizeIdentity("ミズノ")).not.toBe(normalizeIdentity("ミスノ"));
    expect(normalizeIdentity("Йога")).toBe("йога");
    expect(normalizeIdentity("Йога")).not.toBe(normalizeIdentity("Иога"));
  });

  it("keeps a Devanagari vowel sign attached to its syllable", () => {
    // U+093F and U+0902 are marks, and they are half of each syllable: a
    // mark that travels with its letter is part of the token, not a gap.
    expect(normalizeIdentity("हिंदी")).toBe("हिंदी");
  });

  it("recomposes, so a decomposed spelling meets the composed one", () => {
    // NFD Hangul (jamo) and NFD katakana (base + combining dakuten) are the
    // same names as their composed forms, and must land on the same key.
    expect(normalizeIdentity("뉴발란스".normalize("NFD"))).toBe("뉴발란스");
    expect(normalizeIdentity("ミズノ".normalize("NFD"))).toBe("ミズノ");
  });

  it("collapses full-width and half-width compatibility forms", () => {
    expect(normalizeIdentity("ＡＳＩＣＳ")).toBe("asics");
    expect(normalizeIdentity("ﾐｽﾞﾉ")).toBe("ミズノ");
    expect(normalizeIdentity("ナイキ　２")).toBe("ナイキ 2");
  });

  it("folds accents on Latin letters, as it always did", () => {
    expect(normalizeIdentity("Bröoks")).toBe("brooks");
    expect(normalizeIdentity("SAUCONY")).toBe("saucony");
  });

  it("keeps a Latin letter that has no unaccented form", () => {
    // ø does not decompose, so the old `[a-z0-9]` rule turned it into a
    // space and "Norrøna" became two words. Folding it to "o" is R-139.
    expect(normalizeIdentity("Norrøna")).toBe("norrøna");
  });

  it("folds stacked accents, not just the first", () => {
    // ệ decomposes to e + U+0323 + U+0302. Stripping one mark would leave
    // "viêt". Stryker cannot mutate this regex (`\p{Script=…}` is beyond
    // its parser), so this is the hand-written `\p{M}+` -> `\p{M}` mutant.
    expect(normalizeIdentity("Việt")).toBe("viet");
  });

  it("refuses emoji-only and punctuation-only names", () => {
    // The variation selector after 👟 is a mark; once the emoji itself is
    // stripped it must not count as a letter.
    expect(normalizeIdentity("👟️")).toBe("");
    expect(normalizeIdentity("🏃‍♀️ 👟")).toBe("");
    expect(normalizeIdentity("—…・「」")).toBe("");
  });

  it("drops variation selectors and enclosing marks wherever they are", () => {
    // Neither changes which letter it follows. Kept, a text-presentation
    // selector after ミズノ made a second key that renders identically.
    expect(normalizeIdentity("ミズノ\u{FE0E}")).toBe("ミズノ");
    expect(normalizeIdentity("ミズ\u{FE0F}ノ")).toBe("ミズノ");
    // Keycap one: "1" + U+FE0F + U+20E3 (an enclosing mark).
    expect(normalizeIdentity("Nike 1\u{FE0F}\u{20E3}")).toBe("nike 1");
    expect(normalizeIdentity("Nike 1\u{20E3}")).toBe("nike 1");
    // The supplementary selectors (U+E0100…) are variation selectors too.
    expect(normalizeIdentity("ミズノ\u{E0100}")).toBe("ミズノ");
    // A lone enclosing mark is nothing at all, not a token.
    expect(normalizeIdentity("\u{20DD}")).toBe("");
  });

  it("folds Greek accents the way Latin ones are folded", () => {
    // All-caps Greek drops the tonos, so the same name arrives both ways.
    expect(normalizeIdentity("Αθήνα")).toBe("αθηνα");
    expect(normalizeIdentity("ΑΘΗΝΑ")).toBe("αθηνα");
    // ΐ is ι + diaeresis + tonos: stacked, so both must go.
    expect(normalizeIdentity("ΐ")).toBe("ι");
  });

  it("folds Hebrew points and Arabic harakat", () => {
    // שָׁלוֹם with niqqud (qamats, shin dot, holam) is שלום.
    expect(
      normalizeIdentity("\u{5E9}\u{5C1}\u{5B8}\u{5DC}\u{5D5}\u{5B9}\u{5DD}"),
    ).toBe("\u{5E9}\u{5DC}\u{5D5}\u{5DD}");
    // Each end of the Hebrew range, and the marks between its punctuation.
    expect(
      normalizeIdentity(
        "\u{5D0}\u{591}\u{5BD}\u{5BF}\u{5C2}\u{5C4}\u{5C5}\u{5C7}",
      ),
    ).toBe("\u{5D0}");
    // A presentation form decomposes into letter + point under NFKD.
    expect(normalizeIdentity("\u{FB2A}")).toBe("\u{5E9}");
    // مُحَمَّد with harakat (damma, fatha, shadda) is محمد.
    expect(
      normalizeIdentity(
        "\u{645}\u{64F}\u{62D}\u{64E}\u{645}\u{651}\u{64E}\u{62F}",
      ),
    ).toBe("\u{645}\u{62D}\u{645}\u{62F}");
    // Each end of the harakat range, and the superscript alef.
    expect(normalizeIdentity("\u{628}\u{64B}\u{65F}\u{670}")).toBe("\u{628}");
  });

  it("keeps Hebrew punctuation as a word break, not a point", () => {
    // Maqaf (U+05BE), paseq (U+05C0), sof pasuq (U+05C3) and nun hafukha
    // (U+05C6) sit inside the points block but are punctuation.
    for (const mark of ["\u{5BE}", "\u{5C0}", "\u{5C3}", "\u{5C6}"]) {
      expect(normalizeIdentity(`\u{5D0}${mark}\u{5D1}`)).toBe(
        "\u{5D0} \u{5D1}",
      );
    }
  });

  it("still keeps the marks that make a letter", () => {
    // Folding Greek and Hebrew must not widen into folding everything.
    expect(normalizeIdentity("ё")).toBe("ё");
    expect(normalizeIdentity("ё")).not.toBe(normalizeIdentity("е"));
    expect(normalizeIdentity("ガ")).not.toBe(normalizeIdentity("カ"));
  });

  it("folds ß to ss and final sigma to sigma", () => {
    expect(normalizeIdentity("Straße")).toBe("strasse");
    expect(normalizeIdentity("STRASSE")).toBe("strasse");
    // Capital sharp s lowercases to ß, and then folds the same way.
    expect(normalizeIdentity("STRA\u{1E9E}E")).toBe("strasse");
    // Lowercasing writes ς only for a word-final capital Σ; typed in
    // lowercase with σ, the same word must land on the same key.
    expect(normalizeIdentity("ΟΔΟΣ")).toBe("οδοσ");
    expect(normalizeIdentity("οδος")).toBe("οδοσ");
    expect(normalizeIdentity("οδοσ")).toBe("οδοσ");
  });

  it("separates non-Latin words with single spaces", () => {
    expect(normalizeIdentity("  ミズノ・・ウエーブ  ")).toBe("ミズノ ウエーブ");
  });
});

/**
 * Every key already stored was computed by the old `[a-z0-9]` rule, and
 * the curated seed is stored. If an ASCII name normalized differently now,
 * lookups would miss those rows and create-if-missing would write
 * duplicates beside them. For ASCII input the old function reduces to
 * exactly this — NFKD and mark-stripping do nothing to ASCII — so it is
 * the oracle, written out once here rather than kept alive in `src/`.
 */
function asciiRule(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("normalizeIdentity: ASCII keys are unchanged", () => {
  it("matches the old rule on every ASCII character pair", () => {
    // Exhaustive over 128² two-character strings, each between letters so
    // that leading/trailing trimming cannot hide a difference.
    const mismatches: string[] = [];
    for (let first = 0; first < 128; first++) {
      for (let second = 0; second < 128; second++) {
        const value = `a${String.fromCodePoint(first, second)}b`;
        if (normalizeIdentity(value) !== asciiRule(value)) {
          mismatches.push(JSON.stringify(value));
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("matches the old rule on every curated brand", () => {
    for (const brand of CURATED_BRANDS) {
      expect(normalizeIdentity(brand)).toBe(asciiRule(brand));
    }
  });
});
