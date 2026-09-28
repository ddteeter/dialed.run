import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
  FormFailureBand,
  FormStatus,
  Mono,
  PendingLabel,
  SubmitButton,
  inFlight,
  useControlAction,
  useFormSubmit,
} from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import { unsubscribeFormSchema } from "../inputs";
import type { SubscriptionLanding } from "../landing";

const LINK_CLASS = "font-bold text-ink underline underline-offset-4";

/**
 * The unsubscribe landing (round 26 #19, "UNSUBSCRIBE LANDING ·
 * SIGNED-OUT SHELL · NO LOG-IN"). Opening the link changes nothing (D-64:
 * scanners fetch every link); the landing asks, with one Unsubscribe
 * button that POSTs, and then says it is done, with "Turn them back on"
 * to undo it on the same page. The asking state is undrawn (design
 * deltas).
 *
 * The board's second sentence — "If push is on, reminders still show on
 * your phone." — is dropped: there is no push (decision D-44). Listed as a
 * design delta.
 */
export function UnsubscribeLanding({
  landing,
  unsubscribe,
  resubscribe,
}: Readonly<{
  landing: SubscriptionLanding;
  unsubscribe: () => Promise<SubscriptionLanding>;
  resubscribe: () => Promise<SubscriptionLanding>;
}>): JSX.Element {
  const [current, setCurrent] = useState(landing);
  const form = useFormSubmit({
    schema: unsubscribeFormSchema,
    action: () => unsubscribe(),
    onSuccess: setCurrent,
    successMessage: "Unsubscribed.",
  });
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

  if (current.state === "ask") {
    return (
      <SignedOutPanel
        heading="Stop run reminder emails?"
        notice={
          <Mono step="xs" className="text-quiet">
            {current.email}
          </Mono>
        }
      >
        <form
          ref={form.formRef}
          noValidate
          data-part="unsubscribe"
          data-state="ask"
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit({});
          }}
        >
          <FormStatus>{form.status}</FormStatus>
          <p className="m-0 text-lead">
            Account emails, like password changes, still come.
          </p>
          <FormFailureBand
            failure={form.failure}
            onRetry={form.retry}
            retryRef={form.retryRef}
          />
          <SubmitButton
            label="Unsubscribe"
            pendingLabel="Unsubscribing"
            pending={form.pending}
          />
        </form>
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
        {/* The unsubscribe's own "Unsubscribed." until Turn them back on
            says something of its own: the question it answered is gone. */}
        <FormStatus>{control.status || form.status}</FormStatus>
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
