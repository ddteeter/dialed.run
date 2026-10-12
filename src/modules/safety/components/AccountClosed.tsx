import type { JSX } from "react";

import { ACCOUNT_CLOSED_COPY } from "../../../lib/contracts/access";
import { NoticeBand } from "./NoticeBand";

/**
 * Operator Screens D4, as design-deltas item 23 redrew it (round 27,
 * "Au1 account closed Google"): what a banned runner sees when they try
 * to sign in.
 *
 * *"D4's band on Au1, over the empty form, no case line. Same for a
 * password log-in. It never says whether the password was right."* So it
 * is a notice band — round 27's ruling for every notice: "each notice
 * lives on the thing it's about, as a §4a band sized to it", and "the
 * kicker is the state that's still true". One ink rule, no hi-viz and no
 * pink, because nothing here is the runner's to fix, and nothing to press.
 *
 * Not the full page D4 first drew: a banned runner's sessions are deleted
 * with the ban (`banUser`) and the gate refuses every new one
 * (`ban-gate.ts`), so there is no signed-in screen for a notice to
 * replace. The sign-in page is the only place they can be told.
 *
 * No date and no reason. The board's sentence is a statement of the rule,
 * and the operator's own words reach the runner in the ban email, which
 * is also where an appeal goes (D-73): "Reply to the email we sent you."
 */
export function AccountClosed(): JSX.Element {
  return (
    <div data-part="account-closed">
      <NoticeBand
        kicker={ACCOUNT_CLOSED_COPY.kicker}
        message={ACCOUNT_CLOSED_COPY.message}
        detail={ACCOUNT_CLOSED_COPY.detail}
      />
    </div>
  );
}
