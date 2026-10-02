import type { JSX, ReactNode } from "react";

import {
  ControlFailureBand,
  FormStatus,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import type { ControlAction } from "../../../ui";

/**
 * "Keep your account?" (ACC-9) and "Accept the terms" (ACC-6) are the same
 * kind of page: one action that changes something, Log out beside it as the
 * way out that changes nothing. `Leaving.tsx` and `TermsPrompt.tsx` differ
 * only in what the primary action is and what it asks the runner to read
 * first — everything else here is shared rather than carried twice.
 */
const PRIMARY =
  "target inline-flex cursor-pointer items-center justify-center rounded-pill border-none bg-ink px-5 font-bold text-ground no-underline";
const SECONDARY =
  "target inline-flex cursor-pointer items-center justify-center rounded-pill border border-hairline bg-transparent px-5 font-semibold text-ink no-underline";

/**
 * Log out's `ControlAction`, the same on every page that offers it beside a
 * primary action: the kicker is "Still logged in" because that is the one
 * thing a failed log out leaves true, whatever the primary action is.
 */
export function useLogOutAction(
  logOut: () => Promise<unknown>,
): ControlAction<[]> {
  return useControlAction<[]>({ action: logOut, kicker: "Still logged in" });
}

/**
 * The ask-state card: one status region for both actions, the page's own
 * lead copy as `children`, a failure band for each action, then the primary
 * button and Log out. `primary` and `logOut` are each a `ControlAction`, so
 * neither page hand-rolls the pending label, the failure band or the
 * re-entry guard twice.
 */
export function ActionCard({
  primary,
  primaryLabel,
  primaryPendingLabel,
  logOut,
  children,
}: Readonly<{
  primary: ControlAction<[]>;
  primaryLabel: string;
  primaryPendingLabel: string;
  logOut: ControlAction<[]>;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div data-part="landing" data-state="ask" className="flex flex-col gap-6">
      <FormStatus>{primary.status || logOut.status}</FormStatus>
      {children}
      <ControlFailureBand
        failure={primary.failure}
        onRetry={primary.retry}
        retryRef={primary.retryRef}
      />
      <ControlFailureBand
        failure={logOut.failure}
        onRetry={logOut.retry}
        retryRef={logOut.retryRef}
      />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          {...inFlight(primary.pending)}
          className={PRIMARY}
          onClick={() => {
            void primary.run();
          }}
        >
          <PendingLabel
            label={primaryLabel}
            pendingLabel={primaryPendingLabel}
            pending={primary.pending}
          />
        </button>
        <button
          type="button"
          {...inFlight(logOut.pending)}
          className={SECONDARY}
          onClick={() => {
            void logOut.run();
          }}
        >
          <PendingLabel
            label="Log out"
            pendingLabel="Logging out"
            pending={logOut.pending}
          />
        </button>
      </div>
    </div>
  );
}
