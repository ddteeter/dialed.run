import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
  FailureBand,
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
 * The landing's foot, on both states (round 27 #8): where every kind is
 * changed instead.
 */
function SettingsFoot(): JSX.Element {
  return (
    <p className="m-0 border-t border-hairline pt-3 text-body text-quiet">
      Change every kind in{" "}
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
  );
}

/**
 * The unsubscribe landing, as round 27 #8 draws it ("Unsubscribe landing",
 * "Unsubscribe done"; signed-out shell, no log-in). Opening the link
 * changes nothing (D-64: scanners fetch every link); the landing asks,
 * naming the address masked, with one ink Unsubscribe button that POSTs.
 * A failure is the §4a band `STILL SUBSCRIBED`. Done, on the same URL —
 * and on any later visit — it says the emails are off, and "Turn them
 * back on" (a POST too) returns to the question.
 *
 * The board's push sentences are dropped: there is no push (decision
 * D-44). Listed as a design delta.
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
    // Back on the question, the earlier "Unsubscribed." is no longer true.
    onSuccess: () => {
      form.announce("");
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
            Run reminder emails
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
            We&apos;ll stop emailing {current.email} when a run lands on Strava.
            Account emails don&apos;t change.
          </p>
          <SubmitButton
            label="Unsubscribe"
            pendingLabel="Unsubscribing"
            pending={form.pending}
          />
          {form.failure === undefined ? undefined : (
            <FailureBand
              kicker="Still subscribed"
              message="That didn't go through. Try again?"
              onRetry={form.retry}
              retryRef={form.retryRef}
            />
          )}
          <SettingsFoot />
        </form>
      </SignedOutPanel>
    );
  }

  return (
    <SignedOutPanel
      heading="Run reminder emails are off"
      notice={
        <Mono step="xs" className="text-dialed-text">
          Unsubscribed
        </Mono>
      }
    >
      <div
        data-part="unsubscribe"
        data-state="off"
        className="flex flex-col gap-5"
      >
        <FormStatus>{control.status || form.status}</FormStatus>
        <p className="m-0 text-lead">
          You won&apos;t get another one. Strava stays connected.
        </p>
        <button
          type="button"
          {...inFlight(control.pending)}
          onClick={() => {
            void control.run();
          }}
          className={`target cursor-pointer self-start border-none bg-transparent p-0 text-body ${LINK_CLASS}`}
        >
          <PendingLabel
            label="Turn them back on"
            pendingLabel="Turning them on"
            pending={control.pending}
          />
        </button>
        <ControlFailureBand
          failure={control.failure}
          onRetry={control.retry}
          retryRef={control.retryRef}
        />
        <SettingsFoot />
      </div>
    </SignedOutPanel>
  );
}
