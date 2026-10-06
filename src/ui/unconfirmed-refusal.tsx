import { createContext, useContext, useState } from "react";
import type { JSX, ReactNode } from "react";

import type { ConfirmTrigger } from "../lib/auth-signal";

/**
 * A write refused for want of a confirmed address, answered (design 133,
 * decision D-113).
 *
 * The server is the authority: `verifiedUserId` refuses with
 * `EMAIL_UNCONFIRMED` whatever the page thought of the address, because a
 * page's answer is as old as its loader and a runner who confirmed in
 * another tab must not be told to confirm. That refusal is not a failure —
 * nothing broke, and nothing was saved — so it opens "Confirm your email
 * first" with no band and nothing announced, led by the sentence for the
 * control that was refused. *"The control draws at full strength (rule
 * 07: 'not yet'). Pressing it opens a small sheet"* (round 26 #11): it is
 * never disabled and never hidden.
 *
 * **One answer, at the root.** Before this, every screen with a gated
 * control built its own sheet and threaded a guard down to each control,
 * and a refusal reached the sheet only where a screen remembered to wire
 * it. The root provides the answer once, and every form and control hook
 * under it reaches it (`useFormSubmit`, `useControlAction`). A hook with
 * no provider above it — a test — has no answer, and shows the refusal as
 * the failure `classifyFailure` names.
 */
const UnconfirmedRefusal = createContext<
  ((trigger: ConfirmTrigger | undefined) => void) | undefined
>(undefined);

/**
 * The sheet the answer opens, as a render function, because it belongs
 * to `modules/account` (the address is its) and `ui/` may not import a
 * module: the root composes it (`account`'s `confirmEmailOnRefusal`).
 * `trigger` names the control that was refused, so the sheet can lead
 * with its sentence (round 27 #17).
 */
export interface ConfirmGate {
  readonly sheet: (
    state: Readonly<{ open: boolean; trigger: ConfirmTrigger | undefined }>,
    onClose: () => void,
  ) => ReactNode;
}

interface SheetState {
  readonly open: boolean;
  readonly trigger: ConfirmTrigger | undefined;
}

/**
 * The root's provider: everything under it answers an unconfirmed refusal
 * by opening the sheet `gate` draws.
 *
 * **Nothing renders until the first refusal**, so a page nobody is
 * refused on — every signed-out page, and most signed-in ones — carries
 * no dialog and asks the server for nothing. After that the sheet stays
 * mounted, and shutting it keeps the trigger, so the sentence does not
 * change under a closing sheet.
 */
export function UnconfirmedRefusalAnswer({
  gate,
  children,
}: Readonly<{ gate: ConfirmGate; children: ReactNode }>): JSX.Element {
  const [state, setState] = useState<SheetState | undefined>();
  // Not memoised, for `TermsRefusalAnswer`'s reason: the root re-renders
  // only as the route changes.
  const ask = (trigger: ConfirmTrigger | undefined) => {
    setState({ open: true, trigger });
  };
  return (
    <UnconfirmedRefusal.Provider value={ask}>
      {children}
      {state === undefined
        ? undefined
        : gate.sheet(state, () => {
            setState({ open: false, trigger: state.trigger });
          })}
    </UnconfirmedRefusal.Provider>
  );
}

/**
 * The answer to an unconfirmed refusal, or `undefined` with no provider
 * above.
 */
export function useUnconfirmedRefusal():
  ((trigger: ConfirmTrigger | undefined) => void) | undefined {
  return useContext(UnconfirmedRefusal);
}
