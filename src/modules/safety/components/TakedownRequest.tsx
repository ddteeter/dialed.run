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
import { SignedOutPanel, SignedOutReceipt } from "../../../ui/SignedOutPanel";
import type { TakedownRequestResult } from "../takedown-requests";

/**
 * The statement the requester confirms: the Act's good-faith statement,
 * in the first person, in round 35 #58e's words (design 136).
 */
export const ATTESTATION =
  "I believe in good faith this image was shared without consent, and I'm the person in it or acting for them.";

const LABELS = {
  email: "Email",
  signature: "Full name",
  location: "Link to the image",
  posterUsername: "Their dialed.run username · optional",
  description: "What it shows · optional",
  isAttested: "Statement",
} as const;

interface Draft {
  email: string;
  signature: string;
  location: string;
  posterUsername: string;
  description: string;
  isAttested: boolean;
}

const BLANK: Draft = {
  email: "",
  signature: "",
  location: "",
  posterUsername: "",
  description: "",
  isAttested: false,
};

type Request = (input: {
  data: {
    email: string;
    signature: string;
    location: string;
    posterUsername?: string | undefined;
    description: string;
    isAttested: true;
    idempotencyKey: string;
    turnstileToken?: string | undefined;
  };
}) => Promise<TakedownRequestResult>;

/**
 * `/takedown` (design 136, decision D-117): how to ask for an intimate
 * image shared without consent to come down, for anyone, with or without
 * an account. Round 35 #58e draws it: Au5's composition — Turnstile
 * directly above the primary, one receipt. The grey words the board draws
 * in each field are its hint here, since a field never carries a
 * placeholder.
 */
export function TakedownRequest({
  siteKey,
  request,
}: Readonly<{ siteKey: string | undefined; request: Request }>): JSX.Element {
  const [draft, setDraft] = useState(BLANK);
  const { email, signature, posterUsername, isAttested } = draft;
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
  const plainField = (
    key: "location" | "posterUsername" | "description",
    hint: string,
  ) => (
    <TextField
      name={key}
      label={LABELS[key]}
      hint={hint}
      value={draft[key]}
      onChange={edit(key)}
      field={form.field}
      error={form.fieldErrors[key]}
    />
  );
  const submit = () => {
    // An empty username is no username (round 37 #59g), so the schema
    // reads it as absent rather than as a handle too short to be one.
    void form.submit({
      ...draft,
      posterUsername: posterUsername.trim() === "" ? undefined : posterUsername,
      idempotencyKey,
    });
  };

  return (
    <SignedOutPanel heading="Ask us to remove an image">
      {outcome?.status === "received" ? (
        <Receipt email={email} />
      ) : (
        <FormElement form={form} dataPart="form" onSubmit={submit}>
          <p className="m-0 text-body">
            For an intimate image of you, or someone you act for, shared without
            consent. We hide it while we look and decide within 48 hours.
          </p>
          <TextField
            name="email"
            label={LABELS.email}
            hint="Where we'll write back"
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
            hint="Typed as your signature."
            autoComplete="name"
            value={signature}
            onChange={edit("signature")}
            field={form.field}
            error={form.fieldErrors.signature}
          />
          {/* Plain text, not `url`: the hint invites words, and a phone's
              URL keyboard has no space bar to type them with. */}
          {plainField("location", "A dialed.run link, or say where it is.")}
          {plainField("posterUsername", "If you know who posted it.")}
          {plainField("description", "One line")}
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
            label="Send the request"
            pendingLabel="Sending the request"
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
