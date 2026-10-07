import { Link } from "@tanstack/react-router";
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
 * first — everything else here is shared rather than carried twice. So are
 * the two pill styles: "Delete pending" draws them as links
 * (`LogInOrOpen` below), and one class list each serves every control that
 * wears it.
 */
const PRIMARY_PILL =
  "target inline-flex cursor-pointer items-center justify-center rounded-pill border-none bg-ink px-5 font-bold text-ground no-underline";
const SECONDARY_PILL =
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
        <ActionPill
          action={primary}
          label={primaryLabel}
          pendingLabel={primaryPendingLabel}
        />
        <ActionPill
          action={logOut}
          label="Log out"
          pendingLabel="Logging out"
          isSecondary
        />
      </div>
    </div>
  );
}

/**
 * The page's one filled button, an ink pill: Keep on "Keep your account?",
 * and Accept on the terms prompt, which round 30 #4 set on its own row —
 * or, `isSecondary`, Log out's outline pill beside Keep. Shared as a
 * button rather than as its class list, so the pages cannot drift and the
 * class list stays readable where it is used (the 44px target scan reads
 * one file at a time).
 */
export function ActionPill({
  action,
  label,
  pendingLabel,
  isSecondary = false,
}: Readonly<{
  action: ControlAction<[]>;
  label: string;
  pendingLabel: string;
  isSecondary?: boolean;
}>): JSX.Element {
  return (
    <button
      type="button"
      {...inFlight(action.pending)}
      className={isSecondary ? SECONDARY_PILL : PRIMARY_PILL}
      onClick={() => {
        void action.run();
      }}
    >
      <PendingLabel
        label={label}
        pendingLabel={pendingLabel}
        pending={action.pending}
      />
    </button>
  );
}

/**
 * "Delete pending"'s two ways on (ACC-9; round 27 #14), in ActionCard's
 * pill styles as links: Log in, to keep the account inside the week, and
 * Open dialed.run.
 */
export function LogInOrOpen(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Link to="/auth/login" className={PRIMARY_PILL}>
        Log in
      </Link>
      <Link to="/" className={SECONDARY_PILL}>
        Open dialed.run
      </Link>
    </div>
  );
}
