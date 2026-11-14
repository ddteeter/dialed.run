import type { JSX } from "react";

import { PendingLabel, inFlight, useControlAction } from "../../../ui";
import { ControlFailureBand } from "../../../ui";

type SignOutButtonProps = Readonly<
  | {
      signOut: () => Promise<unknown>;
      /**
       * The Desk top bar's Sign out (R55·194): mono caps, underlined, at
       * the bar's right, its failure band hanging under that edge.
       */
      isDeskBar: true;
      isEverywhere?: never;
    }
  | {
      signOut: () => Promise<unknown>;
      isDeskBar?: false | undefined;
      /**
       * ACC-7's "Sign out everywhere", on Settings › Account: every session
       * this account has, this device's included.
       */
      isEverywhere?: boolean | undefined;
    }
>;

const BUTTON =
  "target cursor-pointer self-center border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4";
const DESK_BUTTON =
  "target cursor-pointer border-none bg-transparent px-1 font-mono text-mono-xs text-ink uppercase underline underline-offset-4";

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
export function SignOutButton(props: SignOutButtonProps): JSX.Element {
  const isDeskBar = props.isDeskBar === true;
  const isEverywhere = props.isEverywhere === true;
  const control = useControlAction<[]>({
    action: props.signOut,
    kicker: "Still signed in",
  });

  return (
    <div
      className={isDeskBar ? "flex flex-col items-end" : "flex flex-col gap-3"}
      data-part={isDeskBar ? "desk-sign-out" : undefined}
    >
      <button
        type="button"
        {...inFlight(control.pending)}
        onClick={() => {
          void control.run();
        }}
        className={isDeskBar ? DESK_BUTTON : BUTTON}
      >
        <PendingLabel
          label={isEverywhere ? "Sign out everywhere" : "Sign out"}
          pendingLabel={isEverywhere ? "Signing out everywhere" : "Signing out"}
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
