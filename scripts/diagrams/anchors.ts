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
 * Pure: the files arrive as text. Steps are found line by line, which
 * leans on `likec4 format`'s layout (one step per line), so
 * `scripts/diagram-steps.ts`, in `npm run diagrams:check`, holds the count
 * per view equal to LikeC4's own.
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
const VIEW = /^\s*dynamic view (\w+) \{/u;
const STEP = /^\s*[\w.]+ (?:->|<-|-\[[\w-]+\]->) [\w.]+/u;
const SYMBOL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;
const QUOTED = /'(?:\\.|[^'\\])*'/gu;

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
 * The code on a line, outside `'''` notes, with quoted text and comments
 * removed, and whether a `'''` note is open after it.
 */
function codeOf(
  line: string,
  isInNote: boolean,
): { code: string; isInNote: boolean } {
  const segments = line.split("'''");
  const code = segments
    .filter((_, index) => (index % 2 === 0) !== isInNote)
    .join(" ")
    .replaceAll(QUOTED, "''");
  const comment = code.indexOf("//");
  return {
    code: comment === -1 ? code : code.slice(0, comment),
    isInNote: (segments.length % 2 === 0) !== isInNote,
  };
}

function braceBalance(code: string): number {
  let balance = 0;
  for (const char of code) {
    if (char === "{") balance += 1;
    else if (char === "}") balance -= 1;
  }
  return balance;
}

interface OpenStory {
  view: string;
  file: string;
  steps: Step[];
}

/**
 * The step a line starts, with the comment line above it as its source.
 */
function stepAt(lines: readonly string[], index: number): Step {
  const comment = SOURCE.exec(lines[index - 1] ?? "")?.[1];
  return {
    line: index + 1,
    cites: comment === undefined ? undefined : citesOf(comment),
  };
}

/**
 * Every dynamic view in one `.c4` file, with its steps and their cites.
 */
export function readStories(file: string, text: string): Story[] {
  const stories: OpenStory[] = [];
  const lines = text.split("\n");
  let open: OpenStory | undefined;
  let viewDepth = 0;
  let depth = 0;
  let isInNote = false;
  for (const [index, line] of lines.entries()) {
    const wasInNote = isInNote;
    const read = codeOf(line, isInNote);
    isInNote = read.isInNote;
    const view = wasInNote ? undefined : VIEW.exec(line)?.[1];
    if (view !== undefined) {
      open = { view, file, steps: [] };
      stories.push(open);
      viewDepth = depth;
    } else if (!wasInNote && open !== undefined && STEP.test(line)) {
      open.steps.push(stepAt(lines, index));
    }
    depth += braceBalance(read.code);
    if (open !== undefined && depth <= viewDepth) open = undefined;
  }
  return stories;
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

/**
 * Where the reader's steps per view differ from `counted`, LikeC4's own
 * count, by view id.
 */
export function stepCountProblems(
  stories: readonly Story[],
  counted: ReadonlyMap<string, number>,
): string[] {
  const read = new Map(
    stories.map((story) => [story.view, story.steps.length]),
  );
  return [...new Set([...read.keys(), ...counted.keys()])]
    .toSorted((a, b) => a.localeCompare(b))
    .map((view) => ({
      view,
      mine: read.get(view) ?? 0,
      theirs: counted.get(view) ?? 0,
    }))
    .filter(({ mine, theirs }) => mine !== theirs)
    .map(
      ({ view, mine, theirs }) =>
        `${view}: LikeC4 draws ${String(theirs)} steps and scripts/diagrams/anchors.ts read ${String(mine)}. Write each step on its own line, as likec4 format does, or teach the reader the new form.`,
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
