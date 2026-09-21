import { useEffect } from "react";
import type { JSX, ReactNode } from "react";

/**
 * Which way through the flow this step was reached.
 */
export type FlowDirection = "forward" | "back";

/**
 * How this step was arrived at — the two directions, plus the one that is
 * not a direction at all.
 *
 * `entering` is design round 12's correction to what task 114 shipped. The
 * `NAV` row for `+ Add` types the way *into* the flow as a `rise` — "a task
 * laid on top of where you were" — and only the steps inside it as "Log
 * flow step". A1 was playing the step's trailing-edge slide on an arrival
 * the router now owns, which is two moves on one navigation. So entering
 * carries no class: the rise is the move.
 */
export type FlowArrival = FlowDirection | "entering";

/**
 * Forward unless the step number went down.
 *
 * "Direction tells you which way you are travelling through the flow, so
 * Back feels like back" (design/motion.js, "Log flow step"). Arriving at
 * the step you were already on is forward, which is what `/runs/new` ->
 * `/runs/manual` is.
 *
 * **"No previous step" is the caller's to answer, not this function's.**
 * It used to take `number | undefined` and lead with a `previous !==
 * undefined` guard, which reads as careful and is unkillable: every
 * comparison against `undefined` is false, so the guard and the comparison
 * agree on the only input that reaches it. The caller passes the step
 * itself instead — a runner opening A1 from the tab bar is starting the
 * flow, not returning to it.
 */
export function directionBetween(
  previous: number,
  step: number,
): FlowDirection {
  return step < previous ? "back" : "forward";
}

const STEP_CLASS: Readonly<Record<FlowArrival, string | undefined>> = {
  forward: "flow-step-forward",
  back: "flow-step-back",
  // The router's `rise` is the arrival. Nothing to add.
  entering: undefined,
};

/**
 * The log flow's three screens, in order (docs/product.md §The v1 logging
 * loop): intake, attach the kit, the verdict.
 *
 * Named rather than written as 1/2/3 at four call sites, because the
 * numbers mean nothing on their own — only their order does, and an
 * ordering spread across four files is an ordering nobody can check.
 */
export const LOG_FLOW = { intake: 1, attach: 2, verdict: 3 } as const;

/**
 * The last step this browser rendered.
 *
 * A one-field object rather than a bare `let`, because assigning to a
 * module variable from inside a function is a lint error
 * (`unicorn/no-top-level-assignment-in-function`) and the rule is right
 * about the usual case — this is the unusual one, and the field is the
 * cheapest way to say so without suppressing anything.
 *
 * Module scope rather than state, because the steps are three separate
 * routes: A2 cannot remember what A1 was, since A1 is unmounted before A2
 * mounts. It is written **only from an effect**, which is what keeps it
 * safe on the server — effects do not run there, so a request can never
 * see another request's step, and SSR always renders `entering`. The
 * client's first render agrees with that, because a fresh document starts
 * with nothing here.
 *
 * **Cleared when the flow is left, which is the half that was missing.**
 * It used to persist for the life of the document, so a runner who
 * finished at the verdict and later tapped `+ Add` again arrived at A1
 * with a remembered step of 3 — and the intake slid in backwards, as if
 * they had gone back to it. Clearing on unmount makes "no previous step"
 * mean what it says.
 *
 * The guard is what makes that safe during a step change rather than an
 * exit. React runs a deleted subtree's passive cleanup before the new
 * subtree's passive effects, but both happen after the new step has
 * already *rendered* and read this — so the value is still the old step
 * when it matters, and the outgoing step must only clear a record that is
 * still its own.
 */
// `| undefined` explicitly: `exactOptionalPropertyTypes` distinguishes an
// absent field from one holding `undefined`, and clearing writes the value.
const flow: { lastStep?: number | undefined } = {};

/**
 * One step of the log flow (A1 -> A2 -> A3), entering from the edge it
 * came from — or, on the way in from the bar, not moving at all, because
 * the router's `rise` is the arrival.
 *
 * Only the entering half of the step's own move exists; the reason is in
 * `motion.css` beside the keyframes.
 */
export function FlowStep({
  step,
  children,
}: Readonly<{
  /**
   * Where this screen sits in the flow: 1 intake, 2 attach, 3 verdict.
   * Compared against the last step rendered, so the numbers only have to
   * be ordered, not contiguous.
   */
  step: number;
  children: ReactNode;
}>): JSX.Element {
  const previous = flow.lastStep;
  const arrival: FlowArrival =
    previous === undefined ? "entering" : directionBetween(previous, step);

  useEffect(() => {
    flow.lastStep = step;
    return () => {
      if (flow.lastStep === step) flow.lastStep = undefined;
    };
  }, [step]);

  return (
    <div className={STEP_CLASS[arrival]} data-flow-direction={arrival}>
      {children}
    </div>
  );
}
