import type { JSX, ReactNode } from "react";

import {
  ControlFailureBand,
  FormErrorSummary,
  FormStatus,
  SubmitButton,
} from "../../../ui";
import type { FormShell } from "../../../ui";

/**
 * The Form Contract's frame, once, for the account's small forms — forgot,
 * reset, change password: the status region and the summary at the head,
 * the fields, the band directly above the one submit.
 *
 * `kicker` is the band's first words: the contract's "Nothing saved" by
 * default, and "Not sent" for a form whose thing is an email.
 */
export function ShellForm({
  form,
  onSubmit,
  submitLabel,
  pendingLabel,
  kicker = "Nothing saved",
  children,
}: Readonly<{
  form: FormShell;
  onSubmit: () => void;
  submitLabel: string;
  pendingLabel: string;
  kicker?: string | undefined;
  children: ReactNode;
}>): JSX.Element {
  return (
    <form
      ref={form.formRef}
      noValidate
      data-part="form"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
      {children}
      <ControlFailureBand
        failure={form.failure && { kicker, message: form.failure.message }}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        pending={form.pending}
      />
    </form>
  );
}
