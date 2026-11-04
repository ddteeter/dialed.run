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
 * A Desk's row of buttons: the chalk pill first, then outline pills, then
 * Cancel, side by side and wrapping on a narrow screen (round 44).
 */
export const ACTION_BAR = "flex flex-wrap items-center gap-3";

/**
 * The frame every Desk form shares (Form Contract): the live status, the
 * error summary, the fields, the §4a band directly above the action, and
 * the action bar — the submit first, then anything `also` holds, in one
 * row that wraps, as every board draws a Desk's buttons (round 44).
 * Written once so the Desk's four forms — a review decision, Rename,
 * Close account and a takedown — cannot drift into four answers to "the
 * save failed".
 */
export function DeskForm({
  form,
  onSubmit,
  title,
  className,
  children,
  submit,
  also,
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
  The submit button's words.
  */
  submit: { label: string; pendingLabel: string };
  /**
  The bar's other buttons, after the submit: a quiet action, Cancel.
  */
  also?: ReactNode;
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
      <div className={ACTION_BAR}>
        <SubmitButton
          tone="chalk"
          label={submit.label}
          pendingLabel={submit.pendingLabel}
          pending={form.pending}
        />
        {also}
      </div>
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
