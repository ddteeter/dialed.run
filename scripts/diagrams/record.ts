/**
 * What `npm run diagrams:record` records (design 229, step 4): the views
 * whose hash changed between the merge base and head, how each is played,
 * and the caption, the spoken line (#851) and the hold of every shot.
 *
 * **Decisions only.** The views are read from LikeC4 in
 * `scripts/diagrams/model.ts` (`readViewFacts`); Playwright and ffmpeg are
 * in `scripts/diagram-record.ts`, which follows this plan and decides
 * nothing.
 */
import type { SpokenLine } from "../../e2e/support/speech";

/**
 * One step of a dynamic view, as LikeC4 computes it: who, to whom, the
 * arrow's kind ("" for a plain call), and what it says.
 */
export interface StepFacts {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly label: string;
  readonly notes: string;
}

/**
 * One view, as LikeC4 computes it. `hash` is LikeC4's own: it changes
 * when anything the view draws does, a note or an element's description
 * included. `framed` is true when the view's steps sit in a frame
 * (`try`, `loop`, `opt`, `parallel`) or it declares the sequence variant.
 */
export interface ViewFacts {
  readonly id: string;
  readonly title: string;
  readonly hash: string;
  readonly dynamic: boolean;
  readonly framed: boolean;
  readonly steps: readonly StepFacts[];
}

/**
 * Frames are drawn only in LikeC4's sequence layout, so a framed view is
 * played there; every other view in the diagram layout.
 */
export type Layout = "diagram" | "sequence";

/**
 * What the caption strip says while a shot is on screen, what the voice
 * says over it (nothing over an unchanged step), and for how long. `audio`
 * is the rendered line, once `voicedPlan` has attached it.
 */
export interface Shot {
  readonly caption: string;
  readonly holdMs: number;
  readonly spoken?: string;
  readonly audio?: string;
}

/**
 * One view to record: the whole view first (`opening`), then, for a
 * dynamic view, one shot per step of its walkthrough, in order. The
 * recorder presses Start for the first step and Next for each after.
 */
export interface ViewTake {
  readonly id: string;
  readonly layout: Layout;
  readonly opening: Shot;
  readonly steps: readonly Shot[];
}

export interface RecordingPlan {
  readonly views: readonly ViewTake[];
  /**
  Views at the merge base that head no longer has.
  */
  readonly removed: readonly string[];
}

/**
 * How long a view stays whole before its walkthrough starts: long enough
 * to see its shape.
 */
export const OPENING_MS = 3000;

/**
 * How long a view with no walkthrough (a map of structure) is held.
 */
export const STILL_VIEW_MS = 5000;

/**
 * A step the merge base already had, word for word: a beat, so the
 * reviewer keeps their place without rereading it.
 */
export const UNCHANGED_STEP_MS = 1000;

/**
 * A new or changed step is held long enough to read its label and note
 * at a skim, about 400 words a minute (150 ms a word) after a beat to
 * find it, and never longer than `STEP_MAX_MS`: the reviewer can pause,
 * and the diff has the words.
 */
const STEP_BEAT_MS = 1500;
const MS_PER_WORD = 150;
export const STEP_MAX_MS = 8000;

function wordCount(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

/**
 * How long a step is held: a beat when the merge base had it, else long
 * enough to read.
 */
export function stepHoldMs(step: StepFacts, isChanged: boolean): number {
  if (!isChanged) return UNCHANGED_STEP_MS;
  const reading =
    STEP_BEAT_MS + MS_PER_WORD * wordCount(`${step.label} ${step.notes}`);
  return Math.min(reading, STEP_MAX_MS);
}

/**
 * A step's identity across the two versions: everything it draws and
 * says, not its number, so inserting a step does not mark every later
 * one changed.
 */
function stepKey(step: StepFacts): string {
  return JSON.stringify([
    step.source,
    step.target,
    step.kind,
    step.label,
    step.notes,
  ]);
}

function layoutOf(view: ViewFacts): Layout {
  return view.framed ? "sequence" : "diagram";
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Text as one spoken sentence: a capital first, a stop last, so the voice
 * pauses between a label and what follows it.
 */
function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/u.test(capital) ? capital : `${capital}.`;
}

/**
 * A note as the voice reads it: its Markdown's emphasis and code marks
 * dropped (the voice would read them, or stumble), its paragraphs run
 * together.
 */
function unmarked(notes: string): string {
  return (notes.replaceAll(/[*`]/gu, "").match(/\S+/gu) ?? []).join(" ");
}

/**
 * What the voice says over a new or changed step: its label and its whole
 * note (owner, 2026-11-18), since a note can be all that changed.
 */
export function stepLine(step: StepFacts): string {
  const notes = unmarked(step.notes);
  return notes === ""
    ? sentence(step.label)
    : `${sentence(step.label)} ${notes}`;
}

function newTake(view: ViewFacts): ViewTake {
  const total = view.steps.length;
  const caption = `New view · ${view.id} · ${view.title}`;
  const spoken = `New view: ${sentence(view.title)}`;
  return {
    id: view.id,
    layout: layoutOf(view),
    opening: view.dynamic
      ? {
          caption,
          spoken: `${spoken} ${sentence(plural(total, "step"))}`,
          holdMs: OPENING_MS,
        }
      : { caption, spoken, holdMs: STILL_VIEW_MS },
    steps: view.steps.map((step, index) => ({
      caption: `${view.id} · step ${String(index + 1)} of ${String(total)}`,
      spoken: stepLine(step),
      holdMs: stepHoldMs(step, true),
    })),
  };
}

/**
 * What the opening caption of a changed dynamic view says: how many of
 * its steps are new or changed, and how many fewer it has than at the
 * merge base. An edited step is a new one by content, so "changed" and
 * "new" are one count, and a removal shows only as the view getting
 * shorter. A view can change with every step the same: a frame moved,
 * or an element it draws was redescribed.
 */
function changeSummary(changed: number, total: number, had: number): string {
  const steps =
    changed === 0
      ? "no step changed"
      : `${String(changed)} of ${plural(total, "step")} new or changed`;
  return had > total ? `${steps}, ${String(had - total)} fewer` : steps;
}

function changedTake(view: ViewFacts, before: ViewFacts): ViewTake {
  const had = new Set(before.steps.map((step) => stepKey(step)));
  const changedAt = view.steps.map((step) => !had.has(stepKey(step)));
  const changed = changedAt.filter(Boolean).length;
  const total = view.steps.length;
  const summary = changeSummary(changed, total, before.steps.length);
  return {
    id: view.id,
    layout: layoutOf(view),
    opening: view.dynamic
      ? {
          caption: `Changed · ${view.id} · ${summary}`,
          spoken: `Changed: ${sentence(view.title)} ${sentence(summary)}`,
          holdMs: OPENING_MS,
        }
      : {
          caption: `Changed · ${view.id} · ${view.title}`,
          spoken: `Changed: ${sentence(view.title)}`,
          holdMs: STILL_VIEW_MS,
        },
    steps: view.steps.map((step, index) => {
      const caption = `${view.id} · step ${String(index + 1)} of ${String(total)}`;
      return changedAt.at(index) === true
        ? {
            caption: `${caption} · changed`,
            spoken: stepLine(step),
            holdMs: stepHoldMs(step, true),
          }
        : { caption: `${caption} · unchanged`, holdMs: UNCHANGED_STEP_MS };
    }),
  };
}

/**
 * Whether a view draws and says the same at both ends. LikeC4's hash
 * covers what the view draws, labels and descriptions included, but not
 * a step's notes (measured with likec4 1.61.0: a note edited alone left
 * the hash as it was), and the notes are where a story keeps its guards.
 * So the steps are compared too.
 */
function isUnchanged(was: ViewFacts, view: ViewFacts): boolean {
  return (
    was.hash === view.hash &&
    JSON.stringify(was.steps.map((step) => stepKey(step))) ===
      JSON.stringify(view.steps.map((step) => stepKey(step)))
  );
}

/**
 * The views to record, in head's order: each one new at head, and each
 * whose hash or steps differ from the merge base's. A view that is the
 * same is left out, however its file changed.
 */
export function recordingPlan(
  base: readonly ViewFacts[],
  head: readonly ViewFacts[],
): RecordingPlan {
  const before = new Map(base.map((view) => [view.id, view]));
  const kept = new Set(head.map((view) => view.id));
  const views = head.flatMap((view) => {
    const was = before.get(view.id);
    if (was === undefined) return [newTake(view)];
    return isUnchanged(was, view) ? [] : [changedTake(view, was)];
  });
  const removed = base
    .filter((view) => !kept.has(view.id))
    .map((view) => view.id);
  return { views, removed };
}

/**
 * Every line the plan speaks, once each, in the order spoken: what to
 * render before filming.
 */
export function spokenLines(plan: RecordingPlan): string[] {
  const lines = plan.views.flatMap((view) =>
    [view.opening, ...view.steps].flatMap((shot) => shot.spoken ?? []),
  );
  return [...new Set(lines)];
}

function voicedShot(shot: Shot, lines: ReadonlyMap<string, SpokenLine>): Shot {
  if (shot.spoken === undefined) return shot;
  const line = lines.get(shot.spoken);
  if (line === undefined) {
    throw new Error(`No rendered line for: ${shot.spoken}`);
  }
  return {
    ...shot,
    audio: line.audio,
    holdMs: Math.max(shot.holdMs, line.holdMs),
  };
}

/**
 * The plan with each spoken line attached to its shot, and each shot held
 * until its line has been said: the longer of the planned hold and the
 * line. `lines` maps every line in `spokenLines(plan)` to its rendering;
 * a missing one is a bug in the recorder, so it throws.
 */
export function voicedPlan(
  plan: RecordingPlan,
  lines: ReadonlyMap<string, SpokenLine>,
): RecordingPlan {
  return {
    ...plan,
    views: plan.views.map((view) => ({
      ...view,
      opening: voicedShot(view.opening, lines),
      steps: view.steps.map((step) => voicedShot(step, lines)),
    })),
  };
}

/**
 * How long the recording runs, from the plan alone (the page's own load
 * time comes on top).
 */
export function plannedMs(plan: RecordingPlan): number {
  let total = 0;
  for (const view of plan.views) {
    total += view.opening.holdMs;
    for (const step of view.steps) total += step.holdMs;
  }
  return total;
}

/**
 * The built site's address for one view. `siteUrl` is the single-file
 * build's `file:` URL; the viewer routes on the hash.
 */
export function viewUrl(siteUrl: string, id: string): string {
  return `${siteUrl}#/view/${encodeURIComponent(id)}/`;
}

/**
 * What the run prints: the views it records and the ones that are gone,
 * for the PR body.
 */
export function planReport(plan: RecordingPlan): string {
  const lines =
    plan.views.length === 0
      ? ["No view changed since the merge base: nothing to record."]
      : [
          `Recording ${plural(plan.views.length, "view")}, about ${String(Math.round(plannedMs(plan) / 1000))} s:`,
          ...plan.views.map((view) => `  ${view.opening.caption}`),
        ];
  const removed =
    plan.removed.length === 0
      ? []
      : [`Removed since the merge base: ${plan.removed.join(", ")}`];
  return [...lines, ...removed].join("\n");
}
