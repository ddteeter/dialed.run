/**
 * The instant half of a handle's word check (task 126; owner, 2026-09-27):
 * a vendored open-source list (`./profanity-words.txt`, CC BY 4.0 — see
 * below), matched the moment a handle is claimed. The other half,
 * OpenAI's moderation, lives with the claim (`modules/account`), and this
 * is what is left when it cannot answer.
 *
 * **Whole parts only, never `includes`.** A handle is 3–20 of
 * `[a-z0-9_]`, so the list is compacted to the same alphabet ("g-spot" is
 * `gspot`). A handle is refused when the whole of it, or one of its parts
 * split at `_` or at digits (`big_shit`, `shit99`), or a `_`-part with its
 * digit disguises read back (`sh1t`), *is* a listed word.
 *
 * Matching inside a word was tried and dropped: the list's own words sit
 * inside ordinary ones too often — "semen" in `basement`, "raping" in
 * `scraping`, "coons" in `raccoons`, "twink" in `twinkle`, "negro" in
 * `montenegro` — and a runner refused for their town is the worse
 * failure. A word run into others (`bigshitrunner`) is the moderation
 * check's to catch.
 */
import wordList from "./profanity-words.txt?raw";

/**
 * **The list is vendored data, not code.** It is the English list from
 * "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW,
 * github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words,
 * file `en`, fetched 2026-09-28), © Shutterstock, Inc. and contributors,
 * licensed under **Creative Commons Attribution 4.0 International**
 * (CC BY 4.0, creativecommons.org/licenses/by/4.0/). Changes from the
 * original: the one entry with no letter or digit in it (an emoji, which
 * no handle can contain) is left out. Nothing else is edited, so the list
 * can be re-vendored by replacing the file whole. The attribution the
 * licence asks for is published in `docs/legal/third-party-notices.md`;
 * keep the two in step on a re-vendor.
 *
 * **A text file, one entry per line, and not an array literal**, because
 * of what a mutation tester makes of an array literal: each of its 402
 * strings was a mutant that runs at module load, and such a mutant
 * re-runs every test that imports the file — on every PR that touches a
 * test. Bundled as a string at build time (`?raw`, as `modules/account`
 * bundles its legal texts), so nothing is read at run time.
 * `test/lib/profanity.test.ts` pins its count and checksum, so a botched
 * re-vendor fails there rather than quietly letting words through.
 */

/**
 * A vendored word list, one entry per line: trimmed, so a CRLF checkout or
 * a stray space cannot make a word unmatchable, and with blank lines (the
 * file's trailing newline among them) dropped.
 */
export function parseWordList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export const PROFANE_WORDS: readonly string[] = parseWordList(wordList);

/**
[a-z0-9] only: the handle's alphabet, less `_`, which never carries meaning.
*/
function compact(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

/**
 * Listed words that are innocent in a handle far more often than not, and
 * are refused nowhere (PR #127 review): a bird (`blue_tit`), a name
 * (`dick`, `hooker`), a car (`escort`), a snack (`twinkie`), kisses
 * (`maya_xx`), a trail runner's droppings (`scat`), and the everyday
 * complaint (`hills_suck`, `mondays_sucks`). Slurs and explicit terms are
 * never here. Kept beside the vendored list, not edited into it, so the
 * list can still be re-vendored whole; what gets past this, the
 * moderation check reads in context.
 */
export const INNOCENT_IN_HANDLES: ReadonlySet<string> = new Set([
  "dick",
  "escort",
  "hooker",
  "scat",
  "suck",
  "sucks",
  "tit",
  "twinkie",
  "xx",
]);

const WORDS: ReadonlySet<string> = new Set(
  PROFANE_WORDS.map((word) => compact(word)).filter(
    (word) => !INNOCENT_IN_HANDLES.has(word),
  ),
);

/**
 * Digits read back as the letters they stand in for. `1` reads as both
 * `i` and `l`, so a part yields two spellings.
 */
export function readBackDigits(text: string): [string, string] {
  const plain = text
    .replaceAll("0", "o")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
  return [plain.replaceAll("1", "i"), plain.replaceAll("1", "l")];
}

/**
The whole-part spellings of a handle: see the module comment.
*/
function partsOf(handle: string): string[] {
  const byUnderscore = handle.split("_");
  return [
    handle.replaceAll("_", ""),
    ...readBackDigits(handle.replaceAll("_", "")),
    ...byUnderscore,
    ...byUnderscore.flatMap((part) => readBackDigits(part)),
    // No `+`: a run of digits/underscores splits identically char-by-char
    // for this purpose, since every result here is checked by exact match
    // against `WORDS` and an empty string is never a listed word (the one
    // entry that would compact to "" is excluded — see the module comment).
    // So `+` vs no `+` is a mutant no input can distinguish; not written
    // with it in the first place.
    ...handle.split(/[_0-9]/u),
  ];
}

/**
 * Whether a handle holds a listed word. Takes the stored form, which
 * `usernameSchema` has already lowercased to `[a-z0-9_]`.
 */
export function isProfaneHandle(handle: string): boolean {
  return partsOf(handle).some((part) => WORDS.has(part));
}
