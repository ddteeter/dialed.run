import { useState } from "react";
import type { ReactNode } from "react";

/**
 * A control that waits for something before it may act — today, a
 * confirmed address (round 26 #11; seam 7): Useful and report.
 *
 * *"The control draws at full strength (rule 07: 'not yet'). Pressing it
 * opens a small sheet"* instead of acting. So the control is never
 * disabled and never hidden; the gate only decides what opens.
 *
 * **The server decides, never the page.** A control always asks the
 * server, and opens the sheet only on the server's refusal: a page's
 * answer about the address is as old as its loader, and a runner who
 * confirmed in another tab would otherwise be told to confirm until they
 * navigated. So the gate carries no "may act" — what the page knows is
 * for drawing the nag band, and nothing else.
 *
 * **The sheet is the route's to compose, and that is why this is a
 * render function.** The sheet belongs to the module that owns what is
 * waited on (`modules/account` for the address), while the control
 * belongs to another (`feed`'s Useful, `safety`'s report) — and neither
 * may import the other's components (docs/architecture.md, "Composing
 * across modules"). The route builds the gate; the screen renders the
 * sheet once and opens it from whichever control was refused.
 *
 * `TTrigger` names those controls, so one sheet can say which of them it
 * was opened from (round 27 #17's lead sentence).
 */
export interface ControlGate<TTrigger extends string> {
  readonly sheet: (
    state: Readonly<{ open: boolean; trigger: TTrigger | undefined }>,
    onClose: () => void,
  ) => ReactNode;
}

/**
 * What a gated control needs from the screen that renders the sheet: how
 * to open it, saying which control the server refused.
 */
export interface ControlGuard<TTrigger extends string> {
  readonly ask: (trigger: TTrigger) => void;
}

/**
 * One sheet for the screen, however many controls it gates — a feed of
 * twenty cards, or D's Useful and report, open the same one. Shutting it
 * keeps the trigger, so the sentence does not change under a closing
 * sheet.
 */
export function useControlGate<TTrigger extends string>(
  gate: ControlGate<TTrigger>,
): {
  guard: ControlGuard<TTrigger>;
  sheet: ReactNode;
} {
  const [state, setState] = useState<{
    open: boolean;
    trigger: TTrigger | undefined;
  }>({ open: false, trigger: undefined });
  return {
    guard: {
      ask: (trigger) => {
        setState({ open: true, trigger });
      },
    },
    sheet: gate.sheet(state, () => {
      setState((previous) => ({ ...previous, open: false }));
    }),
  };
}
