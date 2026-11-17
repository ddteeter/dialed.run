/**
 * The stories' steps, from LikeC4's own parse tree (design 229, step 3):
 * each step statement, the dynamic view it is in and the line it starts
 * on. Nothing here reads `.c4` syntax. The source comment on the line
 * above is read by `scripts/diagrams/anchors.ts`.
 *
 * LikeC4 has no public API for its parse tree; it is the `langium` member
 * of a `LikeC4`. It is read as `unknown`, member by member, and every node
 * is parsed, so a likec4 upgrade that moves it fails here, by name, rather
 * than reading nothing (the version is pinned exactly). Each view's arrows,
 * counted from the tree, are held equal to LikeC4's computed view, so a
 * step form the walk does not know fails too.
 *
 * Node: LikeC4 cannot load in the workers pool, so its tests are in the
 * `node` project.
 */
import path from "node:path";

import { LikeC4 } from "likec4";
import { z } from "zod";

import { storyOf, type Story } from "./anchors";

const node = z.looseObject({ $type: z.string() });
type Node = z.infer<typeof node>;

const start = z.object({ line: z.number() });
const range = z.object({ start });
const located = z.looseObject({ $cstNode: z.object({ range }) });

const named = z.looseObject({ name: z.string() });

/**
A step on its own: `a -> b`.
*/
const STEP = "Step";
/**
A chain on one line, `a -> b -> c`: one arrow per target.
*/
const SERIES = "StepSeries";

const MOVED =
  "LikeC4's parse tree is not where scripts/diagrams/model.ts reads it: the pinned likec4 changed. Find it again before upgrading.";

function member(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/**
Calls `value[key]()` on `value` itself, as a method.
*/
function invoke(value: unknown, key: string): unknown {
  const method = member(value, key);
  if (typeof method !== "function") throw new TypeError(MOVED);
  return Reflect.apply(method, value, []);
}

function children(parent: Node): Node[] {
  return Object.entries(parent)
    .filter(([key]) => !key.startsWith("$"))
    .flatMap(([, value]) => {
      const list = z.array(z.unknown()).safeParse(value);
      return list.success ? list.data : [value];
    })
    .flatMap((value) => {
      const child = node.safeParse(value);
      return child.success ? [child.data] : [];
    });
}

function* descendants(root: Node): Generator<Node> {
  for (const child of children(root)) {
    yield child;
    yield* descendants(child);
  }
}

/**
How many arrows a step statement draws.
*/
function arrows(step: Node): number {
  return step.$type === SERIES ? 1 + arrows(node.parse(step.source)) : 1;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

interface Statement {
  readonly line: number;
  readonly arrows: number;
}

/**
The step statements in one dynamic view, frames included.
*/
function statementsIn(parent: Node): Statement[] {
  return children(parent).flatMap((child) =>
    child.$type === STEP || child.$type === SERIES
      ? {
          line: located.parse(child).$cstNode.range.start.line + 1,
          arrows: arrows(child),
        }
      : statementsIn(child),
  );
}

interface Document {
  readonly fsPath: string;
  readonly text: string;
  readonly root: Node;
}

function documentsOf(likec4: LikeC4): Document[] {
  const langium: unknown = Reflect.get(likec4, "langium");
  let all: unknown = langium;
  for (const key of ["shared", "workspace", "LangiumDocuments", "all"]) {
    all = member(all, key);
  }
  const listed = z.array(z.unknown()).safeParse(invoke(all, "toArray"));
  if (!listed.success) throw new Error(MOVED);
  return listed.data.map((doc) => {
    const fsPath = z.string().safeParse(member(member(doc, "uri"), "fsPath"));
    const text = z
      .string()
      .safeParse(invoke(member(doc, "textDocument"), "getText"));
    const root = node.safeParse(member(member(doc, "parseResult"), "value"));
    if (!fsPath.success || !text.success || !root.success) {
      throw new Error(MOVED);
    }
    return { fsPath: fsPath.data, text: text.data, root: root.data };
  });
}

/**
 * Every dynamic view in `likec4`'s own documents (not its built-in
 * library), with each step statement's source comment. `fileOf` names
 * each of those documents in what a story reports.
 */
export async function storiesIn(
  likec4: LikeC4,
  fileOf: (fsPath: string) => string,
): Promise<Story[]> {
  const documents = documentsOf(likec4);
  const workspace = `${path.resolve(likec4.workspace)}${path.sep}`;
  const read = documents
    .filter((doc) => doc.fsPath.startsWith(workspace))
    .flatMap((doc) => {
      const file = fileOf(doc.fsPath);
      return [...descendants(doc.root)]
        .filter((view) => view.$type === "DynamicView")
        .map((view) => {
          const statements = statementsIn(view);
          return {
            story: storyOf(
              named.parse(view).name,
              file,
              doc.text,
              statements.map((statement) => statement.line),
            ),
            arrows: sum(statements.map((statement) => statement.arrows)),
          };
        });
    });

  const drawn = new Map<string, number>();
  const model = await likec4.computedModel();
  const views = [...model.views()];
  for (const view of views) {
    if (view.$view._type === "dynamic") {
      drawn.set(view.id, view.$view.edges.length);
    }
  }
  const misread = [...drawn]
    .filter(
      ([view, count]) =>
        read.find(({ story }) => story.view === view)?.arrows !== count,
    )
    .map(([view]) => view);
  if (misread.length > 0) {
    throw new Error(
      `scripts/diagrams/model.ts read other steps than LikeC4 draws in ${misread.join(", ")}: a step form the walk does not know.`,
    );
  }
  return read.map(({ story }) => story);
}

/**
 * Every story in `docs/diagrams`, each named by its repo-relative file.
 * Run from the repo root.
 */
export async function readModelStories(): Promise<Story[]> {
  const likec4 = await LikeC4.fromWorkspace("docs/diagrams", {
    logger: false,
  });
  return storiesIn(likec4, (fsPath) => path.relative(process.cwd(), fsPath));
}
