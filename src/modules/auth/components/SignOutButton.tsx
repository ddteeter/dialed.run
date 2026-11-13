import { useId } from "react";
import type { JSX } from "react";

import { PendingLabel, inFlight, useControlAction } from "../../../ui";
import { ControlFailureBand } from "../../../ui";

/**
 * The row's two lines, for each of the two sign-outs (R55·182.2): Account's
 * "Every device", the last SIGN-IN row, and Settings' own, the index's last
 * row, alone in its group.
 */
function rowLines(
  isEverywhere: boolean,
  username: string | undefined,
): { title: string; subtitle: string } {
  if (isEverywhere) {
    return {
      title: "Every device",
      subtitle: "Signs out your phone and other browsers",
    };
  }
  return {
    title: username === undefined ? "Signed in" : `Signed in as @${username}`,
    subtitle: "On this phone",
  };
}

/**
 * A sign-out row (R55·182): what it signs out, and one bold `--cold-text`
 * verb at its end, "Sign out", with no chevron, as every row that does
 * something ends. The caller puts it in its list.
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
  isEverywhere = false,
  username,
}: Readonly<{
  signOut: () => Promise<unknown>;
  /**
   * ACC-7's "Sign out everywhere", on Settings › Account: every session
   * this account has, this device's included.
   */
  isEverywhere?: boolean | undefined;
  /**
  Settings' row names who is signed in, by handle once there is one.
  */
  username?: string | undefined;
}>): JSX.Element {
  const control = useControlAction<[]>({
    action: signOut,
    kicker: "Still signed in",
  });
  const lines = rowLines(isEverywhere, username);
  const linesId = useId();

  return (
    <div data-part="sign-out-row" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-hairline py-3">
        {/* The button is the verb alone; the row's lines describe it, so
            "Sign out" is heard with what it signs out. */}
        <span id={linesId} className="flex min-w-0 flex-col gap-1">
          <span className="text-body font-semibold">{lines.title}</span>
          <span className="text-small text-muted">{lines.subtitle}</span>
        </span>
        <button
          type="button"
          {...inFlight(control.pending)}
          aria-describedby={linesId}
          onClick={() => {
            void control.run();
          }}
          className="target shrink-0 cursor-pointer border-none bg-transparent p-0 text-body font-bold text-cold-text"
        >
          <PendingLabel
            label="Sign out"
            pendingLabel="Signing out"
            pending={control.pending}
            // Flush right, the row's edge, as the export row's verb.
            align="end"
          />
        </button>
      </div>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </div>
  );
}
