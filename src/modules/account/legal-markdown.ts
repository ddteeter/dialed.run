/**
 * The legal texts' markdown, read into blocks a reading page renders
 * (task 126, ACC-13; round 28 PR A).
 *
 * **A real parser, and a closed set of what the page draws.** The text is
 * read by `mdast-util-from-markdown` with GFM's table extension, and the
 * tree is mapped onto the page's own `Block`/`Inline` types: a `#` title,
 * `##` and `###` headings, paragraphs, bulleted and numbered lists, tables,
 * block quotes, and inline bold, code and links. **Anything else throws**,
 * naming the construct and its line — emphasis, an image, a code block, a
 * fourth heading level, a nested list — so a construct the owner adds to a
 * file in `docs/legal/` fails the test that parses every one of them,
 * rather than reaching the page as something it cannot draw. The parser
 * this replaced read anything it did not know as text, and merged a
 * numbered list into one paragraph.
 *
 * Server only: the loader's server function runs the parse, and the blocks
 * are what reach the page, never the text or the library.
 */
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  Node,
  PhrasingContent,
  RootContent,
  TableRow,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly Inline[];
    };

export type Block =
  | {
      readonly kind: "section";
      readonly id: string;
      readonly inlines: readonly Inline[];
    }
  | { readonly kind: "subheading"; readonly inlines: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly inlines: readonly Inline[] }
  | { readonly kind: "quote"; readonly inlines: readonly Inline[] }
  | { readonly kind: "list"; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly kind: "numbered";
      /**
      The first item's number, as the source wrote it.
      */
      readonly start: number;
      readonly items: readonly (readonly Inline[])[];
    }
  | {
      readonly kind: "table";
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    };

export interface LegalDoc {
  readonly title: string;
  readonly blocks: readonly Block[];
  /**
  Every `##` heading, in order: the contents list.
  */
  readonly contents: readonly { readonly id: string; readonly title: string }[];
}

/**
 * A heading's id, the way GitHub makes one, so an in-page link written
 * against the rendered file (`[Your choices](#your-choices)`) lands here
 * too: lowercase, punctuation but `-` and `_` dropped, and **each** space a
 * hyphen — `Opt-in  twice` is `opt-in--twice`, as GitHub has it.
 */
export function headingId(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replaceAll(/\s/gu, "-");
}

/**
 * GitHub's ids for a whole text: a heading whose id is already taken gets
 * the first of `-1`, `-2`, … that no heading holds yet. Every heading
 * counts, the title and `###` included, as GitHub counts them — though
 * only a `##` section shows its id here.
 *
 * GitHub's slugger also remembers the last suffix each id reached, and
 * starts from there; ids are never given back, so every suffix below that
 * one is taken and starting from 1 lands on the same id.
 */
function headingIds(): (title: string) => string {
  const taken = new Set<string>();
  return (title) => {
    const base = headingId(title);
    let id = base;
    let suffix = 0;
    while (taken.has(id)) {
      suffix += 1;
      id = `${base}-${String(suffix)}`;
    }
    taken.add(id);
    return id;
  };
}

/**
 * A construct the page does not draw, refused by name. The test that
 * parses every file in `docs/legal/` says which file holds it.
 */
function unsupported(node: Node): never {
  throw new Error(
    `a legal text cannot use ${node.type}: the page does not draw it`,
  );
}

/**
 * A soft line break inside a paragraph is a space, as a browser would
 * read it; the text keeps no trace of where the source wrapped. (The
 * parser has already dropped the spaces either side of the break.)
 */
function unwrapped(text: string): string {
  return text.replaceAll("\n", " ");
}

function inlinesOf(nodes: readonly PhrasingContent[]): Inline[] {
  return nodes.map((node) => inlineOf(node));
}

function inlineOf(node: PhrasingContent): Inline {
  switch (node.type) {
    case "text": {
      return { kind: "text", text: unwrapped(node.value) };
    }
    case "strong": {
      return { kind: "strong", children: inlinesOf(node.children) };
    }
    case "inlineCode": {
      return { kind: "code", text: node.value };
    }
    case "link": {
      return {
        kind: "link",
        href: node.url,
        children: inlinesOf(node.children),
      };
    }
    default: {
      return unsupported(node);
    }
  }
}

/**
 * What a list item or a quote holds when the page can draw it: exactly
 * one paragraph. Two paragraphs, a nested list or a code block inside one
 * is refused.
 */
function onlyParagraph(
  parent: Node,
  children: readonly (BlockContent | DefinitionContent)[],
): Inline[] {
  const [first, ...rest] = children;
  if (first?.type !== "paragraph" || rest.length > 0) unsupported(parent);
  return inlinesOf(first.children);
}

function itemsOf(items: readonly ListItem[]): Inline[][] {
  return items.map((item) => onlyParagraph(item, item.children));
}

function cellsOf(row: TableRow): Inline[][] {
  return row.children.map((cell) => inlinesOf(cell.children));
}

/**
 * The `#` heading, which is the page's title rather than one of its blocks.
 */
interface Title {
  readonly kind: "title";
  readonly inlines: readonly Inline[];
}

/**
 * One top-level node as a block, or the title.
 */
function blockOf(
  node: RootContent,
  idOf: (title: string) => string,
): Block | Title {
  switch (node.type) {
    case "heading": {
      const inlines = inlinesOf(node.children);
      // Taken by every heading, in order, so the ids match GitHub's.
      const id = idOf(plainText(inlines));
      if (node.depth === 1) return { kind: "title", inlines };
      if (node.depth === 2) return { kind: "section", id, inlines };
      if (node.depth === 3) return { kind: "subheading", inlines };
      return unsupported(node);
    }
    case "paragraph": {
      return { kind: "paragraph", inlines: inlinesOf(node.children) };
    }
    case "blockquote": {
      return { kind: "quote", inlines: onlyParagraph(node, node.children) };
    }
    case "list": {
      const items = itemsOf(node.children);
      return node.ordered === true
        ? { kind: "numbered", start: node.start ?? 1, items }
        : { kind: "list", items };
    }
    case "table": {
      // A GFM table always has its head row (without one, micromark
      // reads the lines as a paragraph), so the first row is the head.
      return {
        kind: "table",
        head: node.children.slice(0, 1).flatMap((row) => cellsOf(row)),
        rows: node.children.slice(1).map((row) => cellsOf(row)),
      };
    }
    default: {
      return unsupported(node);
    }
  }
}

/**
 * The whole text: its `#` title, and every other block in order. A text
 * with no title is refused — a legal page with no heading is a file that
 * was not written as one — and so is a second title, which the page has
 * nowhere to put.
 */
export function parseLegalDoc(text: string): LegalDoc {
  const tree = fromMarkdown(text, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  let title: string | undefined;
  const blocks: Block[] = [];
  const idOf = headingIds();
  for (const node of tree.children) {
    const block = blockOf(node, idOf);
    if (block.kind !== "title") {
      blocks.push(block);
    } else if (title === undefined) {
      title = plainText(block.inlines);
    } else {
      unsupported(node);
    }
  }
  if (title === undefined) throw new Error("a legal text needs a # title");
  return {
    title,
    blocks,
    contents: blocks.flatMap((block) =>
      block.kind === "section"
        ? [{ id: block.id, title: plainText(block.inlines) }]
        : [],
    ),
  };
}

/**
What an inline run says, with its marks dropped.
*/
export function plainText(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) =>
      inline.kind === "text" || inline.kind === "code"
        ? inline.text
        : plainText(inline.children),
    )
    .join("");
}

/**
 * The owner's word that a text is final (review of PR #130): the file's
 * first three lines, exactly —
 *
 *     ---
 *     published: true
 *     ---
 *
 * **A positive mark, not a list of unfinished ones.** The gate used to
 * refuse a text holding the draft banner or an `[OWNER:` note, so a
 * reworded banner or a to-do note would have published a draft. Nothing is
 * published until somebody says it is, and saying so is one edit the
 * owner makes on purpose. The source's own comment says how
 * (`docs/legal/privacy-policy.md`).
 */
const PUBLISHED_MARK = "---\npublished: true\n---\n";

/**
 * A notes-to-self comment in a text's source, which the page never shows:
 * the one at the top of each file says how to publish it.
 */
const SOURCE_COMMENT = /<!--[\s\S]*?-->/gu;

/**
 * The text a page may show: everything after the published mark, with the
 * source's comments dropped — or nothing, for a text not marked published.
 */
export function publishedText(text: string): string | undefined {
  if (!text.startsWith(PUBLISHED_MARK)) return undefined;
  return text.slice(PUBLISHED_MARK.length).replaceAll(SOURCE_COMMENT, "");
}
