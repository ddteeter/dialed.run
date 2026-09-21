import { decodeHTML } from "entities";
import { Parser } from "htmlparser2";

/**
 * Reading a page: the `<script>` payloads, the `<meta>` tags and the prose,
 * through a real HTML tokenizer.
 *
 * **This was regular expressions until the PR #72 review asked whether they
 * were good enough, and the measurement said no.** Over the 22 eval pages
 * the Open Graph pattern `content=["']([^"']*)["']` cut a name at its first
 * apostrophe on nine of them — `Men's WoolTech Half Tights` became `Men`,
 * `Arc'teryx` became `Arc` — and the entity strip turned `Men&#39;s` into
 * `Men s`. JSON-LD masked most of it by winning the field first, which is
 * why it went unseen: the page that had only Open Graph got `Men`.
 *
 * Every one of those is the same mistake, which is treating markup as text
 * with a shape. A tokenizer has no bound to outgrow on an attribute, no
 * quote character it stops at, and no entity table to be missing — it
 * decodes attribute values and text on the way through and knows a comment
 * from a tag. htmlparser2 is the choice because it runs anywhere JavaScript
 * does: the consumer is a Worker and the eval is a Node script, and the
 * platform's own `HTMLRewriter` exists only in the first.
 *
 * What is read is deliberately narrow. A rung wants a script by its
 * attributes, a meta by its property, or the words a person would see; none
 * of them wants a DOM, so none is built — one pass, three lists.
 */

export interface ScriptBlock {
  readonly attribs: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface PageRead {
  /**
  Every script, with its attributes and its body exactly as written.
  */
  readonly scripts: readonly ScriptBlock[];
  /**
  Every meta tag's attributes, values decoded.
  */
  readonly metas: readonly Readonly<Record<string, string>>[];
  /**
   * Every text node outside a script or a style, decoded once and in
   * document order. Whole nodes, because a composition arrives as one
   * (measured) and splitting it is the one way to turn a fact into a
   * fragment.
   */
  readonly text: readonly string[];
}

/**
 * The tags whose bodies are code rather than prose, and whether the body
 * is kept: a script is a payload a rung may read, a style is dropped.
 */
const KEEP_BODY_OF = new Map<string, boolean>([
  ["script", true],
  ["style", false],
]);

export function readPage(html: string): PageRead {
  const scripts: ScriptBlock[] = [];
  const metas: Record<string, string>[] = [];
  const text: string[] = [];

  // The tokenizer hands text over in fragments — an entity ends one and
  // starts the next — so a node is accumulated until a tag closes it.
  let node = "";
  // The code block being read, or nothing while in prose. One variable for
  // both kinds, because the tokenizer guarantees the states are exclusive:
  // a script or style body is raw text, so no other tag opens or closes
  // until it ends. That is also why the close handler needs no tag name —
  // whatever closes while `code` is set is the code.
  let code:
    | undefined
    | { attribs: Record<string, string>; body: string; keep: boolean };

  const flush = (): void => {
    if (node !== "") text.push(node);
    node = "";
  };

  const parser = new Parser({
    onopentag(name, attribs) {
      flush();
      if (name === "meta") metas.push(attribs);
      const keep = KEEP_BODY_OF.get(name);
      if (keep !== undefined) code = { attribs, body: "", keep };
    },
    ontext(chunk) {
      if (code === undefined) {
        node += chunk;
      } else {
        code.body += chunk;
      }
    },
    onclosetag() {
      flush();
      if (code?.keep === true) {
        scripts.push({ attribs: code.attribs, body: code.body });
      }
      code = undefined;
    },
  });
  parser.write(html);
  parser.end();
  flush();

  return { scripts, metas, text };
}

/**
 * JSON out of a page, or nothing.
 *
 * Shared by the rungs that read embedded payloads. A malformed block is
 * skipped rather than fatal: pages routinely ship one broken script beside a
 * good one, and a throw here would lose the whole rung.
 */
export function parseJson(json: string): unknown {
  /**
   * **Equivalent mutant: emptying the catch changes nothing.**
   *
   * `catch {}` falls off the end of the function, which is `undefined` — the
   * same value the explicit return produces. That is by design rather than
   * by accident: malformed JSON and "nothing useful in this block" must both
   * make the caller move on, so no caller can distinguish them. Making it
   * observable would mean inventing behaviour to satisfy a mutant.
   *
   * A block pair rather than `next-line`: the mutated line opens with
   * `} catch`, and `next-line` does not attach to a line beginning with a
   * closing brace.
   *
   * **The `restore` sits outside the function, and it has to.** Stryker
   * reads directives from a node's *leading* comments
   * (`DirectiveBookkeeper.processStrykerDirectives`), and a comment on the
   * last line before a closing brace leads no node at all -- it is the
   * previous statement's trailing comment. Written inside, it was never
   * processed and the `disable` above ran to end of file: measured, two
   * `BlockStatement` mutants in `readableText` below came back `Ignored`
   * and the file's 100% was over 62 mutants, not 64. Out here it leads the
   * next declaration, which is a node, so it attaches. Found by
   * guardrails 0.6.0's sanction-placement check.
   */
  // Stryker disable BlockStatement
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed;
  } catch {
    return undefined;
  }
}
// Stryker restore BlockStatement

/**
 * A text node as a reader would see it: entities resolved, whitespace
 * collapsed.
 *
 * The tokenizer decodes once. Real pages are encoded deeper than that — a
 * description round-tripped through JSON and then a template arrives as
 * `&amp;amp;`, three deep on the rabbit page — so this decodes until the
 * text stops changing. Every pass strictly shortens a string it changes,
 * which is why it terminates without a counter.
 *
 * Decoded rather than stripped, and that is a change from the regex
 * version: `&mdash;` is a dash, `&#39;` is an apostrophe, and a model told
 * to copy the page exactly must be shown the page, not the page with its
 * punctuation replaced by spaces.
 */
export function readableText(raw: string): string {
  let decoded = raw;
  let next = decodeHTML(decoded);
  while (next !== decoded) {
    decoded = next;
    next = decodeHTML(decoded);
  }
  return decoded.replaceAll(/\s+/gu, " ").trim();
}
