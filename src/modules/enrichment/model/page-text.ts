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
 * **The cap is characters, not tokens, and that is deliberate.**
 * Counting tokens means shipping a tokenizer for a model we have not chosen
 * yet (D-32), and the ratio is stable enough — measured at 2.5 to 3.6
 * characters a token across this corpus — that a character budget is the
 * same decision with none of the dependency.
 *
 * **40,000 characters, and the number is measured rather than guessed.**
 * It was 24,000 on the reasoning that a real product page carries about
 * four thousand characters of prose and six times that is generous. That
 * was wrong, and the way it was wrong is instructive: a modern product page
 * carries *reviews*, and the corpus runs to 30,783 characters of prose with
 * a median of 16,572. Arc'teryx's Alpha SV states its composition at
 * character 25,646 — past the old cap, so the model was asked about a page
 * whose answer it had never been shown, and answered either nothing or a
 * guess drawn from a marketing banner.
 *
 * Raising it is close to free, because a budget only charges for what it
 * sends: the mean prompt goes from 15,713 characters to 16,393, which is
 * $0.65 to $0.67 per thousand products. 40,000 clears the largest page seen
 * by 30%.
 *
 * Nodes are kept whole, in order. A composition arrives as one text node
 * (measured — that is why it is worth keeping them intact), so cutting
 * mid-node is the one way to turn a fact into a fragment.
 */
const MAX_CHARS = 40_000;

/**
 * Longer than this, a "text node" is not prose.
 *
 * **Measured, and it was hiding a worse bug.** Tracksmith's page carries
 * text nodes of 168,000, 159,000 and 129,000 characters — data that
 * survived script-stripping, not words anyone reads. Sending one would
 * spend the whole budget on a blob; and because the loop below used to
 * *stop* at the first node too big to fit, one of them truncated that page
 * to 2,028 of its 889,578 characters. The model was then recorded as having
 * "found nothing" on a page it had never been shown — which is how a bug in
 * this file became evidence about a model.
 *
 * 8,000 characters is roughly two thousand words, comfortably longer than
 * any real description in the corpus and far below the blobs.
 */
const MAX_NODE_CHARS = 8000;

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
    // `continue`, never `break`: a node that does not fit is one node, and
    // the page's real copy is usually still to come.
    if (text.length > MAX_NODE_CHARS) continue;
    if (total + text.length > MAX_CHARS) continue;
    kept.push(text);
    total += text.length + 1;
  }
  return kept.join("\n");
}
