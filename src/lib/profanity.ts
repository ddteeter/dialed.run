/**
 * The instant half of a handle's word check (task 126; owner, 2026-09-27):
 * a vendored open-source list (`./profanity-words.ts`, CC BY 4.0), matched
 * the moment a handle is claimed. The other half, OpenAI's moderation,
 * lives with the claim (`modules/account`), and this is what is left when
 * it cannot answer.
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
import { PROFANE_WORDS } from "./profanity-words";

/**
[a-z0-9] only: the handle's alphabet, less `_`, which never carries meaning.
*/
function compact(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

const WORDS: ReadonlySet<string> = new Set(PROFANE_WORDS.map((word) => compact(word)));

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
