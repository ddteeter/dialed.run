import { useState } from "react";
import type { ReactNode } from "react";

/**
 * A control that waits for something before it may act — today, a
 * confirmed address (round 26 #11; seam 7): Useful and report.
 *
 * *"The control draws at full strength (rule 07: 'not yet'). Pressing it
 * opens a small sheet"* instead of acting. So the control is never
 * disabled and never hidden; the gate only decides what a press does.
 *
 * **The sheet is the route's to compose, and that is why this is a
 * render function.** The sheet belongs to the module that owns what is
 * waited on (`modules/account` for the address), while the control
 * belongs to another (`feed`'s Useful, `safety`'s report) — and neither
 * may import the other's components (docs/architecture.md, "Composing
 * across modules"). The route builds the gate; the screen holding the
 * control renders the sheet once and opens it.
 */
export interface ControlGate {
  /**
  Whether a press acts now. False opens the sheet instead.
  */
  readonly canAct: boolean;
  readonly sheet: (isOpen: boolean, onClose: () => void) => ReactNode;
}

/**
 * What a gated control needs from the screen that renders the sheet:
 * whether to act, and how to ask instead — which is also what a control
 * does when the server refuses it for the same reason.
 */
export interface ControlGuard {
  readonly canAct: boolean;
  readonly ask: () => void;
}

/**
 * One sheet for the screen, however many controls it gates — a feed of
 * twenty cards opens the same one.
 */
export function useControlGate(gate: ControlGate): {
  guard: ControlGuard;
  sheet: ReactNode;
} {
  const [isAsking, setIsAsking] = useState(false);
  return {
    guard: {
      canAct: gate.canAct,
      ask: () => {
        setIsAsking(true);
      },
    },
    sheet: gate.sheet(isAsking, () => {
      setIsAsking(false);
    }),
  };
}
