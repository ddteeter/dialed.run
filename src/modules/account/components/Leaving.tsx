import { useState } from "react";
import type { JSX } from "react";

import { isAuthRequired } from "../../../lib/auth-signal";
import { Mono, useControlAction } from "../../../ui";
import type { ControlFailure } from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { KeepResult, LeavingView } from "../deletion";
import { ActionCard, LogInOrOpen, useLogOutAction } from "./ActionCard";

/**
 * Round 27 #14's two deletion pages, in the signed-out panel: "Delete
 * pending" — what a runner sees once they have asked, signed out on every
 * device — and "Delete pending sign in", what they see on logging in
 * inside the week. Logging in never cancels silently: Keep my account is
 * the only way back, and Log out leaves the date as it was.
 */
export function Leaving({
  view,
  keep,
  logOut,
  onKept,
}: Readonly<{
  view: LeavingView;
  keep: () => Promise<KeepResult>;
  logOut: () => Promise<unknown>;
  /**
  Where a kept account goes next (the route's to wire).
  */
  onKept: () => Promise<void>;
}>): JSX.Element | undefined {
  // Nothing to say: the route has already sent this visitor home.
  if (view.state === "none") return undefined;
  const notice = (
    <Mono step="xs" className="text-cold-text">
      Deletion scheduled
    </Mono>
  );
  if (view.state === "scheduled") {
    return (
      <SignedOutPanel
        heading={`Your account goes on ${view.day}`}
        notice={notice}
      >
        <div
          data-part="landing"
          data-state="scheduled"
          className="flex flex-col gap-6"
        >
          <p className="m-0 text-lead">
            You&apos;re signed out on every device. Changed your mind? Log in
            before then and choose to keep it.
          </p>
          <LogInOrOpen />
        </div>
      </SignedOutPanel>
    );
  }
  return (
    <SignedOutPanel heading="Keep your account?" notice={notice}>
      <KeepOrLeave day={view.day} keep={keep} logOut={logOut} onKept={onKept} />
    </SignedOutPanel>
  );
}

function KeepOrLeave({
  day,
  keep,
  logOut,
  onKept,
}: Readonly<{
  day: string;
  keep: () => Promise<KeepResult>;
  logOut: () => Promise<unknown>;
  onKept: () => Promise<void>;
}>): JSX.Element {
  const [isTooLate, setIsTooLate] = useState(false);
  const keeping = useControlAction<[]>({
    action: async () => {
      const kept = await keepAnswer(keep);
      setIsTooLate(kept === "too-late");
      if (kept === "kept") await onKept();
    },
    kicker: "Still scheduled",
  });
  const leaving = useLogOutAction(logOut);
  return (
    <ActionCard
      primary={keeping}
      primaryLabel="Keep my account"
      primaryPendingLabel="Keeping"
      logOut={leaving}
      refusal={isTooLate ? TOO_LATE : undefined}
    >
      <p className="m-0 text-lead">
        It&apos;s set to be deleted on {day}, with everything in it. Keep it and
        your runs, closet and entries come back as they were.
      </p>
      {/* Round 28 #12: TYPE.small, muted, under a body that no longer
          promises Strava back. */}
      <p className="m-0 text-small text-muted">{STRAVA_STAYS_DISCONNECTED}</p>
    </ActionCard>
  );
}

/**
 * Keep's answer, with "signed out" read as too late (owner, 2026-10-25).
 * The purge's claim deletes the runner's sessions in the batch that starts
 * it, and Keep's gate refuses a runner it has claimed as nobody, so on
 * this page a signed-out refusal means the purge has begun. Try again
 * cannot work then, so it says NOT KEPT rather than "You were signed out."
 * Any other failure is still a failure to keep, with its band and retry.
 */
async function keepAnswer(
  keep: () => Promise<KeepResult>,
): Promise<KeepResult> {
  try {
    return await keep();
  } catch (error: unknown) {
    if (isAuthRequired(error)) return "too-late";
    throw error;
  }
}

/**
 * Keep pressed after the purge has begun: nothing can stop it now, so
 * round 40 C1's band takes Keep's place — kicker NOT KEPT, as O0's.
 */
export const TOO_LATE: ControlFailure = {
  kicker: "Not kept",
  message: "Your account is already being deleted. It can't be kept now.",
};

/**
 * What Keep does not bring back: the request revoked the Strava grant
 * (ACC-9, seam 5), and a kept account connects again itself. Built from
 * the Strava email's "Strava is disconnected"; round 28 #12 confirms it.
 */
const STRAVA_STAYS_DISCONNECTED =
  "Strava is disconnected, and stays that way until you connect it again.";
