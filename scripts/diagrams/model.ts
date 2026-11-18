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
import {
  framesOf,
  joinSteps,
  type AuditView,
  type ElementFacts,
} from "./audit";
import type { StepFacts, ViewFacts } from "./record";

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

interface ReadStory {
  readonly story: Story;
  /**
  How many arrows each of the story's statements draws, in order.
  */
  readonly arrows: readonly number[];
}

async function readStories(
  likec4: LikeC4,
  fileOf: (fsPath: string) => string,
): Promise<ReadStory[]> {
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
            arrows: statements.map((statement) => statement.arrows),
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
        sum(read.find(({ story }) => story.view === view)?.arrows ?? []) !==
        count,
    )
    .map(([view]) => view);
  if (misread.length > 0) {
    throw new Error(
      `scripts/diagrams/model.ts read other steps than LikeC4 draws in ${misread.join(", ")}: a step form the walk does not know.`,
    );
  }
  return read;
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
  const read = await readStories(likec4, fileOf);
  return read.map(({ story }) => story);
}

/**
 * A note or a description, which LikeC4 keeps as Markdown or as text.
 */
function textOf(
  value: { md: string } | { txt: string } | null | undefined,
): string {
  if (value === undefined || value === null) return "";
  return "md" in value ? value.md : value.txt;
}

interface ComputedEdge {
  readonly source: string;
  readonly target: string;
  readonly kind?: string | null;
  readonly label: string | null;
  readonly notes?: { md: string } | { txt: string };
}

function stepFactsOf(edge: ComputedEdge): StepFacts {
  return {
    source: edge.source,
    target: edge.target,
    kind: edge.kind ?? "",
    label: edge.label ?? "",
    notes: textOf(edge.notes),
  };
}

/**
 * Every view in `likec4`'s computed model, in its own order, as
 * `scripts/diagrams/record.ts` compares them (design 229, step 4). The
 * hash is LikeC4's, and a view is framed when its flow holds anything
 * but a bare step.
 */
export async function viewFactsIn(likec4: LikeC4): Promise<ViewFacts[]> {
  const model = await likec4.computedModel();
  return [...model.views()].map((view) => {
    const computed = view.$view;
    const title = computed.title ?? computed.id;
    if (computed._type !== "dynamic") {
      return {
        id: computed.id,
        title,
        hash: computed.hash,
        dynamic: false,
        framed: false,
        steps: [],
      };
    }
    return {
      id: computed.id,
      title,
      hash: computed.hash,
      dynamic: true,
      framed:
        computed.variant === "sequence" ||
        computed.flow.some((entry) => typeof entry !== "string"),
      steps: computed.edges.map((edge) => stepFactsOf(edge)),
    };
  });
}

/**
 * Every view in the LikeC4 workspace at `dir`.
 */
export async function readViewFacts(dir: string): Promise<ViewFacts[]> {
  return viewFactsIn(await LikeC4.fromWorkspace(dir, { logger: false }));
}

function repoRelative(fsPath: string): string {
  return path.relative(process.cwd(), fsPath);
}

/**
 * Every story in `docs/diagrams`, each named by its repo-relative file.
 * Run from the repo root.
 */
export async function readModelStories(): Promise<Story[]> {
  const likec4 = await LikeC4.fromWorkspace("docs/diagrams", {
    logger: false,
  });
  return storiesIn(likec4, repoRelative);
}

/**
 * Every story in `likec4`'s own documents as skill `diagram-audit` reads
 * it (design 229, step 5): each arrow LikeC4 computed, with its frames and
 * the source comment of the statement that draws it.
 */
export async function auditViewsIn(
  likec4: LikeC4,
  fileOf: (fsPath: string) => string,
): Promise<AuditView[]> {
  const read = await readStories(likec4, fileOf);
  const model = await likec4.computedModel();
  const views = [...model.views()];
  return read.map(({ story, arrows }) => {
    const view = views.find(({ id }) => id === story.view)?.$view;
    if (view?._type !== "dynamic") {
      throw new Error(`${story.view} is not a dynamic view LikeC4 computed.`);
    }
    const edges = view.edges.map((edge) => ({
      id: edge.id,
      navigateTo: edge.navigateTo ?? "",
      ...stepFactsOf(edge),
    }));
    return {
      view: story.view,
      file: story.file,
      title: view.title ?? view.id,
      steps: joinSteps(story, arrows, edges, framesOf(view.flow)),
      elements: view.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        technology: node.technology ?? "",
        description: textOf(node.description),
      })),
    };
  });
}

/**
 * Every element of `likec4`'s computed model, in its own order.
 */
export async function elementsIn(likec4: LikeC4): Promise<ElementFacts[]> {
  const model = await likec4.computedModel();
  return [...model.elements()].map((element) => ({
    id: element.id,
    kind: element.kind,
    title: element.title,
    technology: element.technology ?? "",
    description: textOf(element.$element.description),
  }));
}

/**
 * The stories and the elements of `docs/diagrams`, each story named by its
 * repo-relative file. Run from the repo root.
 */
export async function readAudit(): Promise<{
  readonly views: AuditView[];
  readonly elements: ElementFacts[];
}> {
  const likec4 = await LikeC4.fromWorkspace("docs/diagrams", {
    logger: false,
  });
  return {
    views: await auditViewsIn(likec4, repoRelative),
    elements: await elementsIn(likec4),
  };
}
