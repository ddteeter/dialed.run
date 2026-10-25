import { useState } from "react";
import type { JSX } from "react";

import {
  FormElement,
  FormFailureBand,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import { SignedOutPanel, SignedOutReceipt } from "../../../ui/SignedOutPanel";
import { takedownConfirmInput } from "../inputs";
import type { TakedownConfirmResult } from "../takedown-requests";
import { ElsewhereHelp } from "./ElsewhereHelp";

type Confirm = (input: {
  data: { token: string };
}) => Promise<{ outcome: TakedownConfirmResult }>;

/**
 * `/takedown/confirm` (design 137): a request past the requester cap
 * waits for this before it hides anything. It asks before it confirms,
 * with a button and nothing on arrival, because mail scanners follow
 * links. Undesigned: SignedOutPanel, Au5's receipt, placeholder words
 * (design deltas).
 */
export function TakedownConfirm({
  token,
  confirm,
}: Readonly<{ token: string | undefined; confirm: Confirm }>): JSX.Element {
  const [outcome, setOutcome] = useState<TakedownConfirmResult>();
  const form = useFormSubmit({
    schema: takedownConfirmInput,
    action: (values) => confirm({ data: values }),
    onSuccess: (result) => {
      setOutcome(result.outcome);
    },
    successMessage: "Request confirmed.",
  });

  if (token === undefined || outcome === "not_found") {
    return (
      <SignedOutPanel heading="Confirm your request">
        <p className="m-0 text-body">
          This link doesn&apos;t match a request. Use the link in the email we
          sent, or make the request again.
        </p>
      </SignedOutPanel>
    );
  }
  if (outcome !== undefined) {
    return (
      <SignedOutPanel heading="Confirm your request">
        <SignedOutReceipt
          kicker="Request confirmed"
          title={
            outcome === "decided"
              ? "We've already decided"
              : "We have your request"
          }
        >
          <p className="m-0 text-body">
            {outcome === "decided"
              ? "We've emailed you what we decided."
              : "We'll decide within 48 hours and email you either way."}
          </p>
          <ElsewhereHelp />
        </SignedOutReceipt>
      </SignedOutPanel>
    );
  }
  return (
    <SignedOutPanel heading="Confirm your request">
      <FormElement
        form={form}
        dataPart="form"
        onSubmit={() => {
          void form.submit({ token });
        }}
      >
        <p className="m-0 text-body">
          Confirm that you asked us to remove an image. Then we hide it while we
          look.
        </p>
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Confirm the request"
          pendingLabel="Confirming the request"
          pending={form.pending}
        />
      </FormElement>
    </SignedOutPanel>
  );
}
