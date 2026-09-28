import { useId } from "react";
import type { JSX, ReactNode } from "react";

import {
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Mono,
} from "../../../ui";
import type { FormShell } from "../../../ui";

/**
 * The frame every Desk form shares (Form Contract): the live status, the
 * error summary, the fields, the §4a band directly above the action, and
 * the action. Written once so the Desk's four forms — a review decision,
 * Rename, Close account and a takedown — cannot drift into four answers
 * to "the save failed".
 */
export function DeskForm({
  form,
  onSubmit,
  title,
  className = "flex flex-col gap-3",
  children,
  action,
}: Readonly<{
  form: FormShell;
  onSubmit: () => void;
  /**
  A panel's name, drawn as its heading and naming the form.
  */
  title?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
  action: ReactNode;
}>): JSX.Element {
  const headingId = useId();
  return (
    <form
      ref={form.formRef}
      noValidate
      aria-labelledby={title === undefined ? undefined : headingId}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {title === undefined ? undefined : (
        <h2 id={headingId} className="m-0">
          <Mono step="xs">{title}</Mono>
        </h2>
      )}
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        summaryRef={form.summaryRef}
        onFocusField={form.focusField}
      />
      {children}
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      {action}
    </form>
  );
}
