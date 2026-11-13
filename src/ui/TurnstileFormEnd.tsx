import type { JSX } from "react";

import { refusalMessage } from "../lib/contracts/access";
import type { FormRefusal } from "../lib/contracts/access";
import { FailureBand, FormFailureBand, SubmitButton } from "./form";
import type { FormShell } from "./use-form-submit";
import { Turnstile } from "./Turnstile";

/**
 * The last parts of a signed-out form behind Turnstile (Request access,
 * `/takedown`): the server's refusal as a "Not sent" band with its own
 * retry, the form's band, the widget, then the surface's primary — the
 * ink pill (R54·167.1). One place, so the two forms cannot drift apart.
 */
export function TurnstileFormEnd(
  props: Readonly<{
    form: Pick<FormShell, "failure" | "retry" | "retryRef" | "pending">;
    /**
    The server's refusal of the last send, when it refused.
    */
    refusal: FormRefusal | undefined;
    onRetryRefusal: () => void;
    siteKey: string | undefined;
    /**
    Turnstile's action name, which the server checks.
    */
    action: string;
    turnstile: Readonly<{
      widgetKey: number;
      onToken: (token: string | undefined) => void;
    }>;
    label: string;
    pendingLabel: string;
  }>,
): JSX.Element {
  const { form, refusal, turnstile } = props;
  return (
    <>
      {refusal === undefined ? undefined : (
        <FailureBand
          kicker="Not sent"
          message={refusalMessage(refusal)}
          onRetry={props.onRetryRefusal}
        />
      )}
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <Turnstile
        key={turnstile.widgetKey}
        siteKey={props.siteKey}
        action={props.action}
        onToken={turnstile.onToken}
      />
      <SubmitButton
        label={props.label}
        pendingLabel={props.pendingLabel}
        pending={form.pending}
        tone="ink"
      />
    </>
  );
}
