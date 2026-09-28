import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { TURNSTILE_REFUSED } from "../../../lib/access";
import { requestAccessSchema } from "../../../lib/contracts";
import { clockLabel, deviceTimeZone } from "../../../lib/dates";
import {
  FailureBand,
  FormElement,
  FormFailureBand,
  Mono,
  SubmitButton,
  TextField,
  Turnstile,
  useFormSubmit,
  useTurnstileToken,
} from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { AccessRequestResult } from "../access";

/**
The board's inline link: ink, bold, underlined — never pink.
*/
const INLINE_LINK_CLASS = "font-bold text-ink underline underline-offset-4";

/**
 * What the band says when the request was not taken — both are about the
 * browser, never the address: Turnstile's (round 27 #12) and the limit's
 * (placeholder copy, design deltas).
 */
export function refusalMessage(
  result: Exclude<AccessRequestResult, { status: "received" }>,
): string {
  return result.status === "refused"
    ? TURNSTILE_REFUSED
    : `Too many requests from here. Try again at ${clockLabel(result.until, deviceTimeZone())}.`;
}

/**
 * Au5's receipt (round 26 #20): "You're on the list", the same for a new,
 * a repeated and a registered address — it reveals nothing.
 */
function Receipt({ email }: Readonly<{ email: string }>): JSX.Element {
  return (
    <div data-part="receipt" className="flex flex-col gap-5">
      <Mono step="xs" className="text-muted">
        On the list
      </Mono>
      <h2 className="m-0 text-title font-bold">You&apos;re on the list</h2>
      <p className="m-0 text-body">
        When there&apos;s room, we&apos;ll email a code to{" "}
        <strong>{email}</strong>. There&apos;s nothing else to do until then.
      </p>
      <p className="m-0 pt-4 text-body text-quiet">
        Have a code after all?{" "}
        <Link data-target="inline" to="/auth/signup" className={INLINE_LINK_CLASS}>
          Create an account
        </Link>
      </p>
    </div>
  );
}

/**
 * Au5 · Request access (task 126, ACC-5; round 26 #20): an email and an
 * optional note, Turnstile directly above the primary (round 27 #12), and
 * the one receipt.
 */
export function RequestAccess({
  siteKey,
  request,
}: Readonly<{
  siteKey: string | undefined;
  request: (input: {
    data: { email: string; note: string; turnstileToken?: string | undefined };
  }) => Promise<AccessRequestResult>;
}>): JSX.Element {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  // A token works once: each request takes it, and the widget answers again.
  const turnstile = useTurnstileToken();
  const [outcome, setOutcome] = useState<AccessRequestResult>();
  const form = useFormSubmit({
    schema: requestAccessSchema,
    action: (values) =>
      request({ data: { ...values, turnstileToken: turnstile.take() } }),
    successMessage: "Request sent.",
    labels: { email: "Email", note: "A note · optional" },
    onSuccess: setOutcome,
  });

  return (
    <SignedOutPanel heading="Request access">
      {outcome?.status === "received" ? (
        <Receipt email={email} />
      ) : (
        <FormElement
          form={form}
          dataPart="form"
          onSubmit={() => {
            void form.submit({ email, note });
          }}
        >
          <p className="m-0 text-body">
            We&apos;re letting runners in a few at a time. Leave your email and
            we&apos;ll send a code when there&apos;s room.
          </p>
          <TextField
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            field={form.field}
            error={form.fieldErrors.email}
          />
          <TextField
            name="note"
            label="A note · optional"
            hint="How you run, or who sent you. Up to 280 characters."
            value={note}
            onChange={setNote}
            field={form.field}
            error={form.fieldErrors.note}
          />
          {outcome === undefined ? undefined : (
            <FailureBand
              kicker="Not sent"
              message={refusalMessage(outcome)}
              onRetry={() => {
                void form.submit({ email, note });
              }}
            />
          )}
          <FormFailureBand
            failure={form.failure}
            onRetry={form.retry}
            retryRef={form.retryRef}
          />
          <Turnstile
            key={turnstile.widgetKey}
            siteKey={siteKey}
            action="request-access"
            onToken={turnstile.onToken}
          />
          <SubmitButton
            label="Request access"
            pendingLabel="Sending"
            pending={form.pending}
          />
          <p className="m-0 pt-4 text-body text-quiet">
            <Link
              data-target="inline"
              to="/auth/signup"
              className={INLINE_LINK_CLASS}
            >
              ‹ Create an account
            </Link>
          </p>
        </FormElement>
      )}
    </SignedOutPanel>
  );
}
