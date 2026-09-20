import { useEffect } from "react";
import type { JSX, ReactNode } from "react";

/**
 * Which way through the flow this step was reached.
 */
export type FlowDirection = "forward" | "back";

/**
 * Forward unless the step number went down.
 *
 * "Direction tells you which way you are travelling through the flow, so
 * Back feels like back" (design/motion.js, "Log flow step"). Arriving with
 * no previous step is forward — a runner opening A1 from the tab bar is
 * starting the flow, not returning to it — and so is arriving at the step
 * you were already on, which is what `/runs/new` -> `/runs/manual` is.
 */
export function directionBetween(
  previous: number | undefined,
  step: number,
): FlowDirection {
  return previous !== undefined && step < previous ? "back" : "forward";
}

const STEP_CLASS: Readonly<Record<FlowDirection, string>> = {
  forward: "flow-step-forward",
  back: "flow-step-back",
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
 * see another request's step, and SSR always renders `forward`. The
 * client's first render agrees with that, because a fresh document starts
 * with nothing here.
 */
const flow: { lastStep: number | undefined } = { lastStep: undefined };

/**
 * One step of the log flow (A1 -> A2 -> A3), entering from the edge it
 * came from.
 *
 * Only the entering half of the doctrine's move exists; the reason is in
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
  const direction = directionBetween(flow.lastStep, step);

  useEffect(() => {
    flow.lastStep = step;
  }, [step]);

  return (
    <div className={STEP_CLASS[direction]} data-flow-direction={direction}>
      {children}
    </div>
  );
}
