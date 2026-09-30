import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
  FormStatus,
  Mono,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { KeepResult, LeavingView } from "../deletion";

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
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/auth/login" className={PRIMARY}>
              Log in
            </Link>
            <Link to="/" className={SECONDARY}>
              Open dialed.run
            </Link>
          </div>
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

const PRIMARY =
  "target inline-flex cursor-pointer items-center justify-center rounded-pill border-none bg-ink px-5 font-bold text-ground no-underline";
const SECONDARY =
  "target inline-flex cursor-pointer items-center justify-center rounded-pill border border-hairline bg-transparent px-5 font-semibold text-ink no-underline";

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
      const kept = await keep();
      setIsTooLate(kept === "too-late");
      if (kept === "kept") await onKept();
    },
    kicker: "Still scheduled",
  });
  const leaving = useControlAction<[]>({
    action: logOut,
    kicker: "Still logged in",
  });
  return (
    <div data-part="landing" data-state="ask" className="flex flex-col gap-6">
      <FormStatus>{keeping.status || leaving.status}</FormStatus>
      <p className="m-0 text-lead">
        It&apos;s set to be deleted on {day}, with everything in it. Keep it and
        it all comes back as it was.
      </p>
      <p className="m-0 text-body text-quiet">{STRAVA_STAYS_DISCONNECTED}</p>
      {isTooLate ? (
        <p data-state="too-late" className="m-0 text-body font-semibold">
          {TOO_LATE}
        </p>
      ) : undefined}
      <ControlFailureBand
        failure={keeping.failure}
        onRetry={keeping.retry}
        retryRef={keeping.retryRef}
      />
      <ControlFailureBand
        failure={leaving.failure}
        onRetry={leaving.retry}
        retryRef={leaving.retryRef}
      />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          {...inFlight(keeping.pending)}
          className={PRIMARY}
          onClick={() => {
            void keeping.run();
          }}
        >
          <PendingLabel
            label="Keep my account"
            pendingLabel="Keeping"
            pending={keeping.pending}
          />
        </button>
        <button
          type="button"
          {...inFlight(leaving.pending)}
          className={SECONDARY}
          onClick={() => {
            void leaving.run();
          }}
        >
          <PendingLabel
            label="Log out"
            pendingLabel="Logging out"
            pending={leaving.pending}
          />
        </button>
      </div>
    </div>
  );
}

/**
 * Keep pressed after the purge has begun: nothing can stop it now
 * (undrawn: a design delta).
 */
export const TOO_LATE = "Your account is already being deleted.";

/**
 * What Keep does not bring back: the request revoked the Strava grant
 * (ACC-9, seam 5), and a kept account connects again itself. Built from
 * the Strava email's "Strava is disconnected" (undrawn: a design delta).
 */
const STRAVA_STAYS_DISCONNECTED =
  "Strava is disconnected, and stays that way until you connect it again.";
