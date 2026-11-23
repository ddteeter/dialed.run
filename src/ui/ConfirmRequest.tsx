import { useState } from "react";
import type { JSX, ReactNode } from "react";
import type { z } from "zod";

import { FormElement, FormFailureBand, SubmitButton } from "./form";
import { SignedOutPanel } from "./SignedOutPanel";
import { useFormSubmit, type FormShell } from "./use-form-submit";

/**
 * A confirm link's one button, wired: the token goes to `confirm`, and
 * what it answers becomes the panel's outcome (`outcomeOf`).
 */
export function useConfirmRequest<TResult, TOutcome>({
  schema,
  confirm,
  outcomeOf,
}: Readonly<{
  schema: z.ZodType<{ token: string }>;
  confirm: (input: { data: { token: string } }) => Promise<TResult>;
  outcomeOf: (result: TResult) => TOutcome;
}>) {
  const [outcome, setOutcome] = useState<TOutcome>();
  const form = useFormSubmit({
    schema,
    action: (values) => confirm({ data: values }),
    onSuccess: (result) => {
      setOutcome(outcomeOf(result));
    },
    successMessage: "Request confirmed.",
  });
  return { form, outcome };
}

/**
 * A request's confirm link, opened (`/takedown/confirm`, design 137;
 * `/account/confirm-access`, owner 2026-11-21): it asks before it
 * confirms, with a button and nothing on arrival, because mail scanners
 * follow links (D-64). `children` says what the button will do.
 * Undesigned: SignedOutPanel, Au5's receipt (design deltas).
 */
export function ConfirmRequestPanel({
  form,
  onSubmit,
  children,
}: Readonly<{
  form: Pick<
    FormShell,
    | "formRef"
    | "status"
    | "summaryRows"
    | "focusField"
    | "summaryRef"
    | "failure"
    | "retry"
    | "retryRef"
    | "pending"
  >;
  onSubmit: () => void;
  children: ReactNode;
}>): JSX.Element {
  return (
    <SignedOutPanel heading="Confirm your request">
      <FormElement form={form} dataPart="form" onSubmit={onSubmit}>
        {children}
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Confirm the request"
          pendingLabel="Confirming the request"
          pending={form.pending}
          tone="ink"
        />
      </FormElement>
    </SignedOutPanel>
  );
}

/**
A confirm link that matches no request: unknown, or run out.
*/
export function UnmatchedRequestLink(): JSX.Element {
  return (
    <SignedOutPanel heading="Confirm your request">
      <p className="m-0 text-body">
        This link doesn&apos;t match a request. Use the link in the email we
        sent, or make the request again.
      </p>
    </SignedOutPanel>
  );
}
