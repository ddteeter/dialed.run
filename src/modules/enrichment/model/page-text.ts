import { readableText, textNodes, withoutCode } from "../html";

/**
 * A page as prose, for a model to read.
 *
 * The same two steps the composition pass takes — scripts and styles out,
 * then text nodes — because the question is the same one: what would a
 * person reading this page see. What differs is the budget. A product page
 * is 600 kB to 2.5 MB of markup and perhaps 4 kB of words, and the words
 * are what a token bill is spent on.
 *
 * **The cap is characters, not tokens, and that is deliberate.** Counting
 * tokens means shipping a tokenizer for a model we have not chosen yet
 * (D-32), and the ratio is stable enough — roughly four characters a token
 * for English marketing copy — that a character budget is the same
 * decision with none of the dependency. 24,000 characters is about 6,000
 * tokens, comfortably inside every candidate model's window and about six
 * times the prose a real product page carries, so the cap almost never
 * fires and is a guard rather than a filter.
 *
 * Nodes are kept whole, in order, until the budget runs out. A composition
 * arrives as one text node (measured — that is why the composition pass
 * works on nodes), so cutting mid-node is the one way to turn a fact into
 * a fragment.
 */
const MAX_CHARS = 24_000;

export function pageTextFor(html: string): string {
  const kept: string[] = [];
  let total = 0;
  const nodes = textNodes(withoutCode(html));
  for (const node of nodes) {
    // Through `readableText`, the same decode the composition pass makes:
    // a page arrives with `&amp;` in it, often double-encoded, and a prompt
    // carrying `91% recycled polyester &amp;amp; 9% spandex` teaches the
    // model to copy that into `verbatim` — measured on the rabbit page,
    // which is exactly what it did.
    const text = readableText(node);
    if (text === "") continue;
    if (total + text.length > MAX_CHARS) break;
    kept.push(text);
    total += text.length + 1;
  }
  return kept.join("\n");
}
