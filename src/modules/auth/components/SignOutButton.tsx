import type { JSX } from "react";

import { PendingLabel, inFlight, useControlAction } from "../../../ui";
import { ControlFailureBand } from "../../../ui";

/**
 * U1's "Sign out", at the foot of the settings index.
 *
 * It lived on `/` until round 21 gave the landing page its own bar with
 * one action and nothing else; settings is where U1 draws it. A control
 * outside a form, so it is `useControlAction`'s: `[ Signing out ]` while
 * it waits, and a band saying the runner is still signed in if it fails —
 * the one outcome that must never be silent, since a runner who walks
 * away believing they are signed out on a shared machine is not.
 */
export function SignOutButton({
  signOut,
}: Readonly<{ signOut: () => Promise<unknown> }>): JSX.Element {
  const control = useControlAction<[]>({
    action: signOut,
    kicker: "Still signed in",
  });

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        {...inFlight(control.pending)}
        onClick={() => {
          void control.run();
        }}
        className="target cursor-pointer self-center border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4"
      >
        <PendingLabel
          label="Sign out"
          pendingLabel="Signing out"
          pending={control.pending}
        />
      </button>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </div>
  );
}
