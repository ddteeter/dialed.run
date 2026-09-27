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
import type { SubscriptionLanding } from "../landing";

const LINK_CLASS = "font-bold text-ink underline underline-offset-4";

/**
 * The unsubscribe landing (round 26 #19, "UNSUBSCRIBE LANDING ·
 * SIGNED-OUT SHELL · NO LOG-IN"). Opening the link was the unsubscribe;
 * this says so, and "Turn them back on" undoes it on the same page.
 *
 * The board's second sentence — "If push is on, reminders still show on
 * your phone." — is dropped: there is no push (decision D-44). Listed as a
 * design delta.
 */
export function UnsubscribeLanding({
  landing,
  resubscribe,
}: Readonly<{
  landing: SubscriptionLanding;
  resubscribe: () => Promise<SubscriptionLanding>;
}>): JSX.Element {
  const [current, setCurrent] = useState(landing);
  const control = useControlAction<[]>({
    action: async () => {
      setCurrent(await resubscribe());
    },
    kicker: "Still off",
  });

  if (current.state === "invalid") {
    return (
      <SignedOutPanel heading="That link doesn't work">
        <p
          data-part="unsubscribe"
          data-state="invalid"
          className="m-0 text-lead"
        >
          Change emails in{" "}
          <Link
            data-target="inline"
            to="/account/$section"
            params={{ section: "notifications" }}
            className={LINK_CLASS}
          >
            Settings › Notifications
          </Link>
          .
        </p>
      </SignedOutPanel>
    );
  }

  const isOff = current.state === "off";
  return (
    <SignedOutPanel
      heading={
        isOff ? "Run reminder emails are off" : "Run reminder emails are on"
      }
      notice={
        <Mono step="xs" className="text-dialed-text">
          {`Done · ${current.email}`}
        </Mono>
      }
    >
      <div
        data-part="unsubscribe"
        data-state={current.state}
        className="flex flex-col gap-5"
      >
        <FormStatus>{control.status}</FormStatus>
        <p className="m-0 text-lead">
          {isOff
            ? "You won't get another. Account emails, like password changes, still come."
            : "The next run that lands on Strava gets one."}
        </p>
        {isOff ? (
          <button
            type="button"
            {...inFlight(control.pending)}
            onClick={() => {
              void control.run();
            }}
            className="target cursor-pointer self-start rounded-pill border border-ink bg-transparent px-5 text-body font-semibold text-ink"
          >
            <PendingLabel
              label="Turn them back on"
              pendingLabel="Turning them on"
              pending={control.pending}
            />
          </button>
        ) : undefined}
        <ControlFailureBand
          failure={control.failure}
          onRetry={control.retry}
          retryRef={control.retryRef}
        />
        <p className="m-0 text-body text-quiet">
          <Link
            data-target="inline"
            to="/account/$section"
            params={{ section: "notifications" }}
            className={LINK_CLASS}
          >
            All notification settings ›
          </Link>{" "}
          (asks you to log in)
        </p>
      </div>
    </SignedOutPanel>
  );
}
