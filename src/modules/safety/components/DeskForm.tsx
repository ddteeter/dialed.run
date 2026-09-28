import { useId } from "react";
import type { JSX, ReactNode } from "react";

import type { z } from "zod";

import {
  ChoiceField,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Mono,
  NO_CHOICE,
  SubmitButton,
} from "../../../ui";
import type { FieldProps, FormShell } from "../../../ui";

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
  className,
  children,
  submit,
  action,
}: Readonly<{
  form: FormShell;
  onSubmit: () => void;
  /**
  A panel's name, drawn as its heading and naming the form.
  */
  title?: string | undefined;
  className: string;
  children: ReactNode;
  /**
   * The one submit button's words — or, for a form with more than one
   * decision, `action`: the row of them.
   */
  submit?: { label: string; pendingLabel: string } | undefined;
  action?: ReactNode;
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
      {submit === undefined ? (
        action
      ) : (
        <SubmitButton
          label={submit.label}
          pendingLabel={submit.pendingLabel}
          pending={form.pending}
        />
      )}
    </form>
  );
}

/**
 * One choice from a fixed list, where nothing chosen is `undefined` —
 * which the schema refuses with its own message — and reaches the select
 * as the "—" option's own value. A pick is parsed through the schema.
 */
interface PickOneProps<T extends string> {
  name: string;
  label: string;
  options: readonly T[];
  optionLabels: Readonly<Record<T, string>>;
  schema: z.ZodType<T>;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  field: (name: string) => FieldProps;
  error: string | undefined;
}

export function PickOne<T extends string>(
  props: Readonly<PickOneProps<T>>,
): JSX.Element {
  const { schema, value, onChange, ...choice } = props;
  return (
    <ChoiceField<T>
      {...choice}
      value={value ?? NO_CHOICE}
      onChange={(picked) => {
        onChange(schema.safeParse(picked).data);
      }}
    />
  );
}
