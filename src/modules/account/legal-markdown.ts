/**
 * The legal texts' markdown, read into blocks a reading page renders
 * (task 126, ACC-13).
 *
 * **Only the subset the texts use**: a `#` title, `##` and `###`
 * headings, paragraphs, `-` lists (a line indented under an item carries
 * it on), tables, `>` quotes, and inline `**bold**`, `` `code` `` and
 * `[links](…)`. The texts are files in `docs/legal/`, written here, so a
 * general parser — and a dependency to hold it — would buy nothing a test
 * of the real file does not; anything else reads as the text it is.
 *
 * Pure and framework-free: the parse runs on the server, and the blocks
 * are what reach the page, never the text.
 */

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
 * too.
 */
export function headingId(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-");
}

const MARKS = [
  { open: "**", close: "**" },
  { open: "`", close: "`" },
] as const;

/**
 * The run at `at` if a mark opens there and closes later, with where it
 * ends; otherwise nothing, and the character is text.
 */
function markAt(
  line: string,
  at: number,
): { inline: Inline; end: number } | undefined {
  for (const mark of MARKS) {
    if (!line.startsWith(mark.open, at)) continue;
    const start = at + mark.open.length;
    const close = line.indexOf(mark.close, start);
    if (close <= start) continue;
    const inner = line.slice(start, close);
    const inline: Inline =
      mark.open === "`"
        ? { kind: "code", text: inner }
        : { kind: "strong", children: parseInline(inner) };
    return { inline, end: close + mark.close.length };
  }
  return linkAt(line, at);
}

function linkAt(
  line: string,
  at: number,
): { inline: Inline; end: number } | undefined {
  if (line[at] !== "[") return undefined;
  const middle = line.indexOf("](", at);
  const close = line.indexOf(")", middle);
  if (middle === -1 || close === -1) return undefined;
  return {
    inline: {
      kind: "link",
      href: line.slice(middle + 2, close),
      children: parseInline(line.slice(at + 1, middle)),
    },
    end: close + 1,
  };
}

export function parseInline(line: string): Inline[] {
  const inlines: Inline[] = [];
  let text = "";
  let at = 0;
  // `!==`, not `<`: `at` only ever lands on a character or exactly on the
  // end (a mark's `end` is at most `line.length`), so the two say the same
  // thing — and `<` admits a `<=` mutant no input can tell apart.
  while (at !== line.length) {
    const mark = markAt(line, at);
    if (mark === undefined) {
      text += line.charAt(at);
      at += 1;
      continue;
    }
    if (text !== "") inlines.push({ kind: "text", text });
    text = "";
    inlines.push(mark.inline);
    at = mark.end;
  }
  if (text !== "") inlines.push({ kind: "text", text });
  return inlines;
}

/**
 * A table row's cells: split at `|`, with the pipes that open and close
 * the row dropped.
 */
function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
}

const TABLE_RULE = /^\|[\s|:-]+\|$/u;

/**
One block's lines: never empty, so its first line is always there.
*/
type Lines = readonly [string, ...string[]];

/**
 * The lines of one block — they run to a blank line — as a block.
 */
function blockOf(lines: Lines): Block {
  const [first] = lines;
  if (first.startsWith("### ")) {
    return { kind: "subheading", inlines: parseInline(first.slice(4)) };
  }
  if (first.startsWith("## ")) {
    const title = first.slice(3);
    return {
      kind: "section",
      id: headingId(title),
      inlines: parseInline(title),
    };
  }
  if (first.startsWith(">")) {
    const text = lines.map((line) => line.replace(/^>\s?/u, "")).join(" ");
    return { kind: "quote", inlines: parseInline(text) };
  }
  if (first.startsWith("|")) {
    const [head, ...rest] = lines;
    return {
      kind: "table",
      head: cells(head),
      rows: rest
        .filter((line) => !TABLE_RULE.test(line))
        .map((line) => cells(line)),
    };
  }
  if (first.startsWith("- ")) {
    // An item runs until the next line that starts one.
    const items = lines
      .join("\n")
      .split(/\n(?=- )/u)
      .map((item) =>
        item
          .slice(2)
          .split("\n")
          .map((line) => line.trim())
          .join(" "),
      );
    return { kind: "list", items: items.map((item) => parseInline(item)) };
  }
  return {
    kind: "paragraph",
    inlines: parseInline(lines.map((line) => line.trim()).join(" ")),
  };
}

/**
 * A heading is a block of its own even with no blank line after it.
 */
function isHeading(line: string): boolean {
  return line.startsWith("#");
}

/**
The text's lines, grouped into blocks at blank lines and headings.
*/
function groups(text: string): Lines[] {
  const out: Lines[] = [];
  let current: string[] = [];
  const close = () => {
    const [first, ...rest] = current;
    if (first !== undefined) out.push([first, ...rest]);
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "" || isHeading(line)) close();
    if (isHeading(line)) out.push([line]);
    else if (line.trim() !== "") current.push(line);
  }
  close();
  return out;
}

/**
 * The whole text: its `#` title, and every other block in order. A text
 * with no title is refused — a legal page with no heading is a file that
 * was not written as one.
 */
export function parseLegalDoc(text: string): LegalDoc {
  let title: string | undefined;
  const blocks: Block[] = [];
  for (const lines of groups(text)) {
    const [first] = lines;
    if (first.startsWith("# ")) title ??= first.slice(2);
    else blocks.push(blockOf(lines));
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
