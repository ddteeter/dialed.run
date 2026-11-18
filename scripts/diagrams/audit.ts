/**
 * What skill `diagram-audit` hands its two readers, and which flows are
 * due an audit (design 229, step 5).
 *
 * - `briefText`: the deriving reader's brief. Where each story starts and
 *   the model's element ids, and nothing a story says past its first step.
 * - `storyText`: the comparing reader's copy of the story: every arrow
 *   LikeC4 draws, with its frames, notes, source comment and link, and the
 *   elements as each view describes them.
 * - `dueFlows`: the flows never audited, and those whose stories PR bodies
 *   answered "re-read" (skill `pr-ready`, under **Diagrams**) in
 *   `DUE_AFTER_REREADS` or more merged PRs since their last audit.
 *
 * **Decisions only, and pure.** The steps come from LikeC4's computed views
 * and parse tree in `scripts/diagrams/model.ts`; the PRs and the audit
 * records come from `gh` in `scripts/diagram-audit.sh`.
 */
import type { Cite, Story } from "./anchors";
import type { StepFacts } from "./record";

/**
 * One entry of a computed dynamic view's `flow`: a step's id, or a frame
 * holding more entries. `try` holds a `try-block` and its `try-catch` or
 * `try-finally`; `alt` holds its branches.
 */
export type FlowEntry =
  | string
  | {
      readonly _type: string;
      readonly title?: string | undefined;
      readonly flow: readonly FlowEntry[];
    };

/**
 * How a frame reads in the story text, by its computed `_type`. `""` is a
 * frame that only holds others and says nothing itself. A type not listed
 * throws, so a frame a likec4 upgrade adds is not printed as a bare step.
 */
const FRAME_WORDS: ReadonlyMap<string, string> = new Map([
  ["try", ""],
  ["try-block", "try"],
  ["try-catch", "catch"],
  ["try-finally", "finally"],
  ["alt", ""],
  ["alt-if", "if"],
  ["alt-when", "when"],
  ["alt-else", "else"],
  ["loop", "loop"],
  ["opt", "opt"],
  ["par", "parallel"],
  ["break", "break"],
]);

function frameName(entry: Exclude<FlowEntry, string>): string | undefined {
  const word = FRAME_WORDS.get(entry._type);
  if (word === undefined) {
    throw new Error(
      `scripts/diagrams/audit.ts does not know the frame ${entry._type}: add it to FRAME_WORDS.`,
    );
  }
  if (word === "") return undefined;
  return entry.title ? `${word} '${entry.title}'` : word;
}

/**
 * Each step id in `flow`, with the frames around it, outermost first.
 */
export function framesOf(
  flow: readonly FlowEntry[],
  outer: readonly string[] = [],
): Map<string, readonly string[]> {
  const frames = new Map<string, readonly string[]>();
  for (const entry of flow) {
    if (typeof entry === "string") {
      frames.set(entry, outer);
      continue;
    }
    const name = frameName(entry);
    const inner = name === undefined ? outer : [...outer, name];
    for (const [id, around] of framesOf(entry.flow, inner)) {
      frames.set(id, around);
    }
  }
  return frames;
}

/**
 * One arrow as LikeC4 computes it, with its id and the view its step
 * links to (`navigateTo`; "" for none).
 */
export interface Edge extends StepFacts {
  readonly id: string;
  readonly navigateTo: string;
}

/**
 * One arrow of a story: what LikeC4 draws, the frames around it, and the
 * source comment of the statement that draws it.
 */
export interface AuditStep extends Edge {
  readonly frames: readonly string[];
  readonly cites: readonly Cite[] | undefined;
}

/**
 * An element of the model. In a view, its words are the view's own, with
 * any `include … with { description … }` applied.
 */
export interface ElementFacts {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly technology: string;
  readonly description: string;
}

export interface AuditView {
  readonly view: string;
  readonly file: string;
  readonly title: string;
  readonly steps: readonly AuditStep[];
  readonly elements: readonly ElementFacts[];
}

/**
 * Joins a story's statements to the arrows LikeC4 computed for it. Both
 * are in source order, and statement `i` draws `arrows[i]` of them (a
 * chain `a -> b -> c` draws two), so each arrow takes its statement's
 * source comment. Every arrow must have its place in `frames`, which
 * `framesOf` gives every step of the view's flow.
 */
export function joinSteps(
  story: Story,
  arrows: readonly number[],
  edges: readonly Edge[],
  frames: ReadonlyMap<string, readonly string[]>,
): AuditStep[] {
  let total = 0;
  for (const count of arrows) total += count;
  if (arrows.length !== story.steps.length || total !== edges.length) {
    throw new Error(
      `${story.view}: ${String(story.steps.length)} statements drawing ${String(total)} arrows, but LikeC4 computed ${String(edges.length)}`,
    );
  }
  let next = 0;
  return story.steps.flatMap((step, index) => {
    const drawn = edges.slice(next, next + (arrows[index] ?? 0));
    next += drawn.length;
    return drawn.map((edge) => {
      const around = frames.get(edge.id);
      if (around === undefined) {
        throw new Error(
          `${story.view}: the arrow ${edge.id} is not in the view's flow.`,
        );
      }
      return { ...edge, frames: around, cites: step.cites };
    });
  });
}

function arrowOf(kind: string): string {
  return kind === "" ? "->" : `-[${kind}]->`;
}

function citeText(cites: readonly Cite[] | undefined): string {
  if (cites === undefined) return "(no source comment)";
  return cites
    .map((cite) => {
      const named = `${cite.path} ${cite.symbols.join(", ")}`;
      return cite.note === undefined ? named : `${named} (${cite.note})`;
    })
    .join("; ");
}

function indented(text: string, by: string): string[] {
  return text
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `${by}${line.trim()}`));
}

function stepLines(step: AuditStep, number: number): string[] {
  const lines = [
    `${String(number)}. ${step.source} ${arrowOf(step.kind)} ${step.target}: ${step.label}`,
  ];
  if (step.frames.length > 0) lines.push(`   in: ${step.frames.join(" > ")}`);
  lines.push(`   source: ${citeText(step.cites)}`);
  if (step.navigateTo !== "") lines.push(`   opens: ${step.navigateTo}`);
  if (step.notes.trim() !== "") {
    lines.push("   notes:", ...indented(step.notes, " ".repeat(5)));
  }
  return lines;
}

function described(element: ElementFacts): string {
  const said = [element.technology, element.description]
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return `- ${element.id} (${element.kind}): ${[element.title, ...said].join(". ")}`;
}

/**
 * The story as the comparing reader reads it: every view of the flow's
 * file, each arrow numbered within its view; then the words each view
 * gives its elements, which are claims too; then the other flows'
 * stories, which mark where this one's scope ends.
 */
export function storyText(
  views: readonly AuditView[],
  others: readonly Pick<AuditView, "view" | "title" | "file">[],
): string {
  const told = views
    .flatMap((view) => view.elements)
    .filter(
      (element) => element.technology !== "" || element.description !== "",
    );
  const words = [...new Set(told.map((element) => described(element)))];
  return [
    ...views.flatMap((view) => [
      `## ${view.view}: ${view.title}`,
      "",
      ...view.steps.flatMap((step, index) => stepLines(step, index + 1)),
      "",
    ]),
    "## The elements, as these views describe them",
    "",
    ...words,
    "",
    "## Other flows' stories",
    "",
    ...(others.length === 0
      ? ["(none)"]
      : others.map(
          (other) => `- ${other.view}: ${other.title} (${other.file})`,
        )),
  ].join("\n");
}

/**
 * Whether a view is a recovery view (`<flow>Recovery`, skill
 * `architecture-diagrams`), whose first step the brief does not give.
 */
function isRecovery(view: Pick<AuditView, "view">): boolean {
  return view.view.endsWith("Recovery");
}

/**
 * The deriving reader's brief: each story's title, its first step and
 * where that is in the code, then the ids it may name. No step past each
 * story's first, no recovery view, and no element's words, which are the
 * story's claims too.
 */
export function briefText(
  views: readonly AuditView[],
  elements: readonly ElementFacts[],
): string {
  const starts = views
    .filter((view) => !isRecovery(view))
    .map((view) => ({ title: view.title, first: view.steps[0] }))
    .filter(
      (start): start is { title: string; first: AuditStep } =>
        start.first !== undefined,
    );
  if (starts.length === 0) {
    throw new Error("A flow to audit needs a story with at least one step.");
  }
  return [
    "The flow starts at each of these. Derive from every one:",
    "",
    ...starts.flatMap(({ title, first }, index) => [
      `${String(index + 1)}. ${title}`,
      `   It starts with: ${first.source} ${arrowOf(first.kind)} ${first.target}: ${first.label}`,
      `   In the code: ${citeText(first.cites?.map(({ path, symbols }) => ({ path, symbols })))}`,
    ]),
    "",
    "Elements of the model, by id. Name a step's two ends with these; when nothing fits, say so:",
    "",
    ...elements.map(
      (element) => `- ${element.id} (${element.kind}): ${element.title}`,
    ),
  ].join("\n");
}

/**
 * A merged PR, as `gh pr list --json number,mergedAt,body` gives it.
 */
export interface MergedPr {
  readonly number: number;
  readonly mergedAt: string;
  readonly body: string;
}

/**
 * An audit's record issue, as `gh issue list --json title,createdAt` gives
 * it. Its title is `auditTitle`'s.
 */
export interface AuditRecord {
  readonly title: string;
  readonly createdAt: string;
}

/**
 * How many merged PRs may answer a flow's stories "re-read" before it is
 * due an audit. Each re-read is a reader checking the story against the
 * code without rewriting it; past a few, nobody has derived it afresh.
 */
export const DUE_AFTER_REREADS = 3;

const AUDIT_TITLE = "Diagram audit: ";

/**
 * The record title for an audit of `file` on `date` (YYYY-MM-DD).
 * `npm run diagrams:audit -- due` prints it for each flow due.
 */
export function auditTitle(file: string, date: string): string {
  return `${AUDIT_TITLE}${file} (${date})`;
}

const DATED = /^(.+) \(\d{4}-\d{2}-\d{2}\)$/u;

function auditedFile(title: string): string | undefined {
  return title.startsWith(AUDIT_TITLE)
    ? DATED.exec(title.slice(AUDIT_TITLE.length))?.[1]
    : undefined;
}

const HEADING = /^(#{1,6})\s/u;
const DIAGRAMS = /^(?:(#{1,6})\s+Diagrams|\*\*Diagrams\*\*)\s*$/u;
const REREAD = /\bre-?read/iu;

function escaped(word: string): string {
  return word.replaceAll("$", String.raw`\$`);
}

/**
 * How deep a heading line is (`##` is 2), or 0 for a line that is not one.
 */
function depthOf(line: string): number {
  return HEADING.exec(line)?.[1]?.length ?? 0;
}

/**
 * Which of `views` a PR body answers "re-read" under its Diagrams heading
 * (`## Diagrams` at any depth, or a line `**Diagrams**`): each named, as a
 * whole word, on a line that says re-read. The section runs to the next
 * heading as deep or shallower.
 */
export function rereadViews(
  body: string,
  views: readonly string[],
): Set<string> {
  const found = new Set<string>();
  const named = views.map((view) => ({
    view,
    pattern: new RegExp(String.raw`(?<![\w$])${escaped(view)}(?![\w$])`, "u"),
  }));
  let depth = 0;
  for (const line of body.split(/\r?\n/u)) {
    const opens = DIAGRAMS.exec(line.trim());
    if (opens !== null) {
      depth = opens[1]?.length ?? 7;
      continue;
    }
    const level = depthOf(line);
    if (level > 0 && level <= depth) depth = 0;
    if (depth === 0 || !REREAD.test(line)) continue;
    for (const { view, pattern } of named) {
      if (pattern.test(line)) found.add(view);
    }
  }
  return found;
}

export interface FlowDue {
  readonly file: string;
  /**
  When the flow was last audited (the record's `createdAt`), if ever.
  */
  readonly lastAudit: string | undefined;
  /**
  The merged PRs since then that answered one of its views "re-read".
  */
  readonly rereads: readonly number[];
  readonly due: boolean;
}

export interface Due {
  /**
  Every flow file that holds a story, never audited first, then oldest audit first.
  */
  readonly flows: readonly FlowDue[];
  /**
  Record titles that name no flow file, or not in `auditTitle`'s form.
  */
  readonly strays: readonly string[];
}

function latest(values: readonly string[]): string | undefined {
  return values.toSorted((a, b) => b.localeCompare(a))[0];
}

/**
 * Which flows are due an audit: never audited, or re-read in
 * `DUE_AFTER_REREADS` merged PRs since the last.
 */
export function dueFlows(
  stories: readonly Pick<Story, "view" | "file">[],
  prs: readonly MergedPr[],
  audits: readonly AuditRecord[],
): Due {
  const files = [...new Set(stories.map((story) => story.file))];
  const strays = audits
    .map((record) => record.title)
    .filter((title) => title.startsWith(AUDIT_TITLE))
    .filter((title) => !files.includes(auditedFile(title) ?? ""));
  const flows = files.map((file) => {
    const views = stories
      .filter((story) => story.file === file)
      .map((story) => story.view);
    const lastAudit = latest(
      audits
        .filter((record) => auditedFile(record.title) === file)
        .map((record) => record.createdAt),
    );
    const rereads = prs
      .filter((pr) => lastAudit === undefined || pr.mergedAt > lastAudit)
      .filter((pr) => rereadViews(pr.body, views).size > 0)
      .map((pr) => pr.number)
      .toSorted((a, b) => a - b);
    return {
      file,
      lastAudit,
      rereads,
      due: lastAudit === undefined || rereads.length >= DUE_AFTER_REREADS,
    };
  });
  return {
    flows: flows.toSorted((a, b) =>
      (a.lastAudit ?? "").localeCompare(b.lastAudit ?? ""),
    ),
    strays,
  };
}

function dueLine(flow: FlowDue): string {
  const audited =
    flow.lastAudit === undefined
      ? "never audited"
      : `last audited ${flow.lastAudit.slice(0, 10)}`;
  const count = flow.rereads.length;
  const prs = flow.rereads.map((number) => `#${String(number)}`).join(", ");
  const plural = count === 1 ? "PR" : "PRs";
  const reread =
    count === 0
      ? "no re-read since"
      : `re-read in ${String(count)} ${plural} since (${prs})`;
  return `- ${flow.file}: ${audited}; ${reread}`;
}

/**
 * What `npm run diagrams:audit -- due` prints on `date` (YYYY-MM-DD): the
 * flows due, each with the record title to file, the rest, and any record
 * whose title the count cannot read.
 */
export function dueReport(due: Due, date: string): string {
  const owed = due.flows.filter((flow) => flow.due);
  const rest = due.flows.filter((flow) => !flow.due);
  return [
    owed.length === 0
      ? "No flow is due a diagram audit."
      : `Due a diagram audit (never audited, or re-read in ${String(DUE_AFTER_REREADS)}+ merged PRs since the last):`,
    ...owed.flatMap((flow) => [
      dueLine(flow),
      `  record: ${auditTitle(flow.file, date)}`,
    ]),
    ...(rest.length === 0
      ? []
      : ["", "Not due:", ...rest.map((flow) => dueLine(flow))]),
    ...(due.strays.length === 0
      ? []
      : [
          "",
          "Records that name no flow file, or not as `Diagram audit: <flow file> (<YYYY-MM-DD>)`; fix their titles, or the count ignores them:",
          ...due.strays.map((title) => `- ${title}`),
        ]),
  ].join("\n");
}
