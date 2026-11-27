/**
 * Every user-facing string of B2's evidence, once (design 194 §Decisions,
 * "LLM": templates over counted facts, never generated text).
 *
 * Each entry says where its wording comes from, so the owner round has one
 * place to read and a test can list the guesses:
 *
 * - `board`: drawn on a board of `design/Call Epic.dc.html` (named in the
 *   comment above it), with the board's numbers turned into slots;
 * - `said`: the spoken form of a drawn line, the brackets dropped and the
 *   measures said (D-150, `docs/product.md` §Bracket notation);
 * - `guess`: wording this lane wrote where no board draws one (a plural, a
 *   fact with no drawn line, every "why not" answer). Each is a question
 *   for the owner (QUESTIONS.md).
 *
 * A slot is `{name}`; `fill` types the slots from the text.
 */

import { words } from "./words-data";

export type WordKey = keyof typeof words;

/**
The slot names in a template: `"a {x} b {y}"` gives `"x" | "y"`.
*/
type Slots<S extends string> = S extends `${string}{${infer K}}${infer R}`
  ? K | Slots<R>
  : never;

/**
 * A template with its slots filled. The slots are typed from the text, so
 * a missing or misspelt one does not compile.
 */
export function fill<K extends WordKey>(
  key: K,
  slots: Readonly<Record<Slots<(typeof words)[K]["text"]>, string>>,
): string {
  const values: Readonly<Record<string, string>> = slots;
  let text: string = words[key].text;
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{${name}}`).join(value);
  }
  return text;
}
