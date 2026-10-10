import { useState } from "react";
import type { JSX } from "react";

import { refusalMessage } from "../../../lib/contracts/access";
import { takedownRequestSchema } from "../../../lib/contracts/takedown";
import {
  FailureBand,
  FieldMessage,
  FormElement,
  FormFailureBand,
  SubmitButton,
  TextField,
  ToggleField,
  Turnstile,
  useFormSubmit,
  useIdempotencyKey,
  useTurnstileToken,
} from "../../../ui";
import {
  SignedOutPanel,
  SignedOutReceipt,
} from "../../../ui/SignedOutPanel";
import type { TakedownRequestResult } from "../takedown-requests";

/**
 * The statement the requester confirms: the Act's good-faith statement,
 * in the first person (design 136). Placeholder words (design deltas
 * item 58).
 */
export const ATTESTATION =
  "I am the person shown, or I'm allowed to act for them, and this image was shared without their consent.";

const LABELS = {
  email: "Email",
  signature: "Your full name",
  location: "Link to the image",
  description: "What it shows · optional",
  isAttested: "Statement",
} as const;

interface Draft {
  email: string;
  signature: string;
  location: string;
  description: string;
  isAttested: boolean;
}

const BLANK: Draft = {
  email: "",
  signature: "",
  location: "",
  description: "",
  isAttested: false,
};

type Request = (input: {
  data: {
    email: string;
    signature: string;
    location: string;
    description: string;
    isAttested: true;
    idempotencyKey: string;
    turnstileToken?: string | undefined;
  };
}) => Promise<TakedownRequestResult>;

/**
 * `/takedown` (design 136, decision D-117): how to ask for an intimate
 * image shared without consent to come down, for anyone, with or without
 * an account. Undesigned: Au5's composition — Turnstile directly above the
 * primary, one receipt — with placeholder words (design deltas item 58).
 */
export function TakedownRequest({
  siteKey,
  request,
}: Readonly<{ siteKey: string | undefined; request: Request }>): JSX.Element {
  const [draft, setDraft] = useState(BLANK);
  const { email, signature, location, description, isAttested } = draft;
  const edit =
    <Key extends keyof Draft>(key: Key) =>
    (value: Draft[Key]) => {
      setDraft((before) => ({ ...before, [key]: value }));
    };
  const { idempotencyKey } = useIdempotencyKey();
  const [outcome, setOutcome] = useState<TakedownRequestResult>();
  // A token works once: each request takes it, and the widget answers again.
  const turnstile = useTurnstileToken();
  const form = useFormSubmit({
    schema: takedownRequestSchema,
    successMessage: "Request sent.",
    labels: LABELS,
    action: (values) =>
      request({ data: { ...values, turnstileToken: turnstile.take() } }),
    onSuccess: setOutcome,
  });
  const submit = () => {
    void form.submit({ ...draft, idempotencyKey });
  };

  return (
    <SignedOutPanel heading="Ask us to remove an intimate image">
      {outcome?.status === "received" ? (
        <Receipt email={email} />
      ) : (
        <FormElement form={form} dataPart="form" onSubmit={submit}>
          <p className="m-0 text-body">
            If someone posted an intimate image of you without your consent,
            tell us where it is. You don&apos;t need an account. A person reads
            every request and decides within 48 hours, and we email you the
            outcome.
          </p>
          <TextField
            name="email"
            label={LABELS.email}
            type="email"
            autoComplete="email"
            value={email}
            onChange={edit("email")}
            field={form.field}
            error={form.fieldErrors.email}
          />
          <TextField
            name="signature"
            label={LABELS.signature}
            hint="Typing it is your signature."
            autoComplete="name"
            value={signature}
            onChange={edit("signature")}
            field={form.field}
            error={form.fieldErrors.signature}
          />
          <TextField
            name="location"
            label={LABELS.location}
            hint="A dialed.run link, or say where it is."
            type="url"
            value={location}
            onChange={edit("location")}
            field={form.field}
            error={form.fieldErrors.location}
          />
          <TextField
            name="description"
            label={LABELS.description}
            value={description}
            onChange={edit("description")}
            field={form.field}
            error={form.fieldErrors.description}
          />
          {/* A checkbox with an error is not `ToggleField`'s job, so its
              sentence goes under it, as O3's tap-list does with a group's. */}
          <div className="flex flex-col gap-2">
            <ToggleField
              name="isAttested"
              label={ATTESTATION}
              field={form.field}
              isOn={isAttested}
              onChange={edit("isAttested")}
            />
            <FieldMessage
              name="isAttested"
              error={form.fieldErrors.isAttested}
            />
          </div>
          {outcome === undefined ? undefined : (
            <FailureBand
              kicker="Not sent"
              message={refusalMessage(outcome)}
              onRetry={submit}
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
            action="takedown"
            onToken={turnstile.onToken}
          />
          <SubmitButton
            label="Send request"
            pendingLabel="Sending request"
            pending={form.pending}
          />
        </FormElement>
      )}
    </SignedOutPanel>
  );
}

/**
The receipt: what happens next, the same for every request.
*/
function Receipt({ email }: Readonly<{ email: string }>): JSX.Element {
  return (
    <SignedOutReceipt kicker="Request sent" title="We have your request">
      <p className="m-0 text-body">
        A person will look at it and decide within 48 hours. We&apos;ve emailed
        a receipt to <strong>{email}</strong>, and we&apos;ll email you the
        outcome.
      </p>
    </SignedOutReceipt>
  );
}
