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
A settings row: Account's Every device, or Settings' own.
*/
interface SettingsRowProps {
  /**
   * ACC-7's "Sign out everywhere", on Settings › Account: every session
   * this account has, this device's included.
   */
  isEverywhere?: boolean | undefined;
  /**
  Settings' row names who is signed in, by handle once there is one.
  */
  username?: string | undefined;
  isDeskBar?: false | undefined;
}

/**
 * The Desk bar's Sign out (R55·194): mono capitals, underlined, at the
 * bar's right edge, rather than a settings row. It signs out this device
 * only, and names nobody.
 */
interface DeskBarProps {
  isDeskBar: true;
  isEverywhere?: undefined;
  username?: undefined;
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
  isDeskBar = false,
}: Readonly<
  { signOut: () => Promise<unknown> } & (SettingsRowProps | DeskBarProps)
>): JSX.Element {
  const control = useControlAction<[]>({
    action: signOut,
    kicker: "Still signed in",
  });

  return (
    <div
      data-part={isDeskBar ? "desk-sign-out" : "sign-out-row"}
      // At the Desk bar the failure band hangs under the bar's right edge.
      className={isDeskBar ? "flex flex-col items-end" : "flex flex-col gap-3"}
    >
      {isDeskBar ? (
        <DeskBarSignOut control={control} />
      ) : (
        <SignOutRow
          control={control}
          lines={rowLines(isEverywhere, username)}
        />
      )}
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </div>
  );
}

type SignOutControl = ReturnType<typeof useControlAction<[]>>;

/**
 * The settings row: its two lines, and the verb as the button. The row's
 * lines describe it, so "Sign out" is heard with what it signs out.
 */
function SignOutRow({
  control,
  lines,
}: Readonly<{
  control: SignOutControl;
  lines: { title: string; subtitle: string };
}>): JSX.Element {
  const linesId = useId();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline py-3">
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
  );
}

/**
The Desk bar's: mono capitals, underlined, flush with the bar's right edge.
*/
function DeskBarSignOut({
  control,
}: Readonly<{ control: SignOutControl }>): JSX.Element {
  return (
    <button
      type="button"
      {...inFlight(control.pending)}
      onClick={() => {
        void control.run();
      }}
      className="target cursor-pointer border-none bg-transparent px-1 font-mono text-mono-xs text-ink uppercase underline underline-offset-4"
    >
      <PendingLabel
        label="Sign out"
        pendingLabel="Signing out"
        pending={control.pending}
        align="end"
      />
    </button>
  );
}
