/**
 * The stories' source comments (design 229, step 3). Every step of a
 * dynamic view carries, on the line above it,
 *
 *     // source: <path> <symbol>[, <symbol>…] [(<note>)][; <path> …]
 *
 * `anchorProblems` fails a step with no comment, a path that is not a file
 * and a symbol the file does not contain; `staleStories` lists the views
 * that cite a file a branch changed. The note in parentheses is prose for
 * the reader and is not checked, so a name that must keep resolving goes
 * before it, as a symbol.
 *
 * Pure: the files arrive as text, and where each step is comes from
 * LikeC4's parse tree (`scripts/diagrams/model.ts`). Nothing here reads
 * `.c4` syntax; it reads only the comment's own form.
 */

export interface Cite {
  readonly path: string;
  readonly symbols: readonly string[];
}

export interface Step {
  readonly line: number;
  /**
  `undefined` when the line above is not a source comment.
  */
  readonly cites: readonly Cite[] | undefined;
}

export interface Story {
  readonly view: string;
  readonly file: string;
  readonly steps: readonly Step[];
}

const SOURCE = /^\s*\/\/ source:(.*)$/u;
const SYMBOL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;

/**
 * Splits on `separator` where no parenthesis is open, so a note may hold
 * one.
 */
function splitOutsideParens(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

/**
 * `src/a.ts f, g (a note)` → its path and its symbols. The note is dropped.
 */
function citeOf(text: string): Cite {
  const open = text.indexOf("(");
  const named = (open === -1 ? text : text.slice(0, open)).trim();
  const [path = "", ...rest] = named.split(" ");
  const symbols = rest
    .join(" ")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol !== "");
  return { path, symbols };
}

function citesOf(comment: string): Cite[] {
  return splitOutsideParens(comment, ";").map((cite) => citeOf(cite));
}

/**
 * One story: the view's name, its file, and a step at each line in
 * `stepLines` (1-based, as LikeC4's parse tree places them; see
 * `scripts/diagrams/model.ts`), whose source is the line directly above.
 */
export function storyOf(
  view: string,
  file: string,
  text: string,
  stepLines: readonly number[],
): Story {
  const lines = text.split("\n");
  return {
    view,
    file,
    steps: stepLines.map((line) => {
      const comment = SOURCE.exec(lines[line - 2] ?? "")?.[1];
      return {
        line,
        cites: comment === undefined ? undefined : citesOf(comment),
      };
    }),
  };
}

function escaped(word: string): string {
  return word.replaceAll("$", String.raw`\$`);
}

/**
 * Whether `text` holds `symbol` as a whole word; a dotted symbol
 * (`queues.consumers`) needs each of its parts.
 */
function hasSymbol(text: string, symbol: string): boolean {
  return symbol
    .split(".")
    .every((part) =>
      new RegExp(String.raw`(?<![\w$])${escaped(part)}(?![\w$])`, "u").test(
        text,
      ),
    );
}

function citeProblems(
  cite: Cite,
  files: ReadonlyMap<string, string>,
): string[] {
  const text = files.get(cite.path);
  if (text === undefined) return [`${cite.path} is not a file`];
  if (cite.symbols.length === 0) return [`${cite.path} names no symbol`];
  return cite.symbols
    .filter((symbol) => !SYMBOL.test(symbol) || !hasSymbol(text, symbol))
    .map((symbol) =>
      SYMBOL.test(symbol)
        ? `${cite.path} has no ${symbol}`
        : `"${symbol}" is not a symbol`,
    );
}

/**
 * One line per problem, each naming the step's file, line and view:
 * a step with no source comment, a cite of a path `files` does not hold,
 * a cite with no symbol, or a symbol its file does not contain.
 */
export function anchorProblems(
  stories: readonly Story[],
  files: ReadonlyMap<string, string>,
): string[] {
  return stories.flatMap((story) =>
    story.steps.flatMap((step) => {
      const where = `${story.file}:${String(step.line)} (${story.view})`;
      const problems =
        step.cites === undefined
          ? ["the step has no // source: comment above it"]
          : step.cites.flatMap((cite) => citeProblems(cite, files));
      return problems.map((problem) => `${where}: ${problem}`);
    }),
  );
}

export interface StaleStory {
  readonly view: string;
  readonly file: string;
  /**
  The changed files the view cites, in the order it first cites them.
  */
  readonly changed: readonly string[];
  /**
  Whether the branch changed the view's own `.c4` file.
  */
  readonly edited: boolean;
}

/**
 * The views that cite a file in `changed`.
 */
export function staleStories(
  stories: readonly Story[],
  changed: readonly string[],
): StaleStory[] {
  const touched = new Set(changed);
  return stories
    .map((story) => ({
      view: story.view,
      file: story.file,
      changed: [
        ...new Set(
          story.steps
            .flatMap((step) => step.cites ?? [])
            .map((cite) => cite.path)
            .filter((path) => touched.has(path)),
        ),
      ],
      edited: touched.has(story.file),
    }))
    .filter((story) => story.changed.length > 0);
}

/**
 * What `npm run diagrams:stale` prints.
 */
export function staleReport(stale: readonly StaleStory[]): string {
  if (stale.length === 0) {
    return "No story cites a file this branch changed.";
  }
  return [
    'Stories that cite a file this branch changed. Under "Diagrams" in the PR body, say for each whether you updated it or re-read it and it still holds:',
    ...stale.map(
      (story) =>
        `- ${story.view} (${story.file}${story.edited ? ", edited on this branch" : ""}): ${story.changed.join(", ")}`,
    ),
  ].join("\n");
}
