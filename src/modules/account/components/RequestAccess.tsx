import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  ACCESS_NOTE_COUNT_FROM,
  ACCESS_NOTE_MAX,
  TURNSTILE_REFUSED,
} from "../../../lib/contracts/access";
import { requestAccessSchema } from "../../../lib/contracts";
import { clockLabel, deviceTimeZone } from "../../../lib/dates";
import {
  FailureBand,
  FormElement,
  FormFailureBand,
  Icon,
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
 * (round 28 #9, #11's grammar in local time).
 */
export function refusalMessage(
  result: Exclude<AccessRequestResult, { status: "received" }>,
): string {
  return result.status === "refused"
    ? TURNSTILE_REFUSED
    : `Too many requests from here. You can send another at ${clockLabel(result.until, deviceTimeZone())}.`;
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
        <Link
          data-target="inline"
          to="/auth/signup"
          className={INLINE_LINK_CLASS}
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

/**
 * Round 28 #9's back link: the pack's `back` glyph and the destination's
 * name, above the heading — never "‹".
 */
function BackToSignUp(): JSX.Element {
  return (
    <Link
      to="/auth/signup"
      className="target inline-flex items-center gap-1 self-start font-semibold text-quiet no-underline"
    >
      <Icon name="back" size={20} />
      Create an account
    </Link>
  );
}

/**
 * The note's counter, from 120 of its 140 characters (round 28 #9): a
 * count, so mono, and quiet until it matters. Polite, so a screen reader
 * hears it once typing pauses rather than on every key.
 */
export function NoteCounter({
  length,
}: Readonly<{ length: number }>): JSX.Element | undefined {
  if (length < ACCESS_NOTE_COUNT_FROM) return undefined;
  return (
    <span aria-live="polite" className="self-end">
      <Mono step="xs" className="text-muted">
        {`${String(length)} / ${String(ACCESS_NOTE_MAX)}`}
      </Mono>
    </span>
  );
}

/**
 * Au5 · Request access (task 126, ACC-5; round 26 #20, round 28 #9): an
 * email and a one-line optional note, Turnstile directly above the
 * primary (round 27 #12), and the one receipt.
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
    labels: { email: "Email", note: "Note · optional" },
    onSuccess: setOutcome,
  });

  return (
    <SignedOutPanel
      heading="Request access"
      notice={outcome?.status === "received" ? undefined : <BackToSignUp />}
    >
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
          <div className="flex flex-col gap-2">
            <TextField
              name="note"
              label="Note · optional"
              hint="Where you run, or who sent you. One line."
              value={note}
              onChange={setNote}
              field={form.field}
              error={form.fieldErrors.note}
            />
            <NoteCounter length={note.length} />
          </div>
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
            label="Send request"
            pendingLabel="Sending"
            pending={form.pending}
          />
        </FormElement>
      )}
    </SignedOutPanel>
  );
}
