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
    // ø and ß do not decompose, so the old `[a-z0-9]` rule turned them into
    // a space and "Norrøna" became two words.
    expect(normalizeIdentity("Norrøna")).toBe("norrøna");
    expect(normalizeIdentity("Straße")).toBe("straße");
  });

  it("refuses emoji-only and punctuation-only names", () => {
    // The variation selector after 👟 is a mark; once the emoji itself is
    // stripped it has no letter to belong to and must not count as one.
    expect(normalizeIdentity("👟️")).toBe("");
    expect(normalizeIdentity("🏃‍♀️ 👟")).toBe("");
    expect(normalizeIdentity("—…・「」")).toBe("");
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
