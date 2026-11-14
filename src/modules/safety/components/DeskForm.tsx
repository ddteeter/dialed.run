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
import { shortId } from "./short-id";

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
  /**
  The fields, if the form asks for any.
  */
  children?: ReactNode;
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
      // A Desk form keeps the 620 column, on Review's and Runners' wide
      // pages too (168.3); on a column page it is already that wide.
      className={`${className} max-w-column`}
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
  /**
  `ChoiceField`'s: the option the list is ruled off before.
  */
  hairlineBefore?: T | undefined;
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

/**
 * A held record on Review's foot, a copyright hold or a quarantine record
 * (R55·199): the queue's own card, round and 12 apart (`ListSection
 * hasCards`), its head, body and bar parted by hairlines (R2-DESK-08).
 */
export const RECORD_PANEL =
  "flex flex-col gap-3 rounded-card border border-hairline bg-panel p-4";

/**
The rule above a record's bar, as the queue's card draws one.
*/
export const RECORD_BAR = "border-t border-hairline pt-3";

/**
What a record's head names: its kind, id, owner (if any) and what holds it.
*/
interface RecordNaming {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly owner?: string | undefined;
  readonly tag: string;
}

/**
 * `kind · id · @owner [tag]`, the id at its ends, as one line of words: what
 * a screen reader hears, in the words' own case.
 */
export function recordName({
  subjectType,
  subjectId,
  owner,
  tag,
}: RecordNaming): string {
  const whose = owner === undefined ? "" : ` · @${owner}`;
  return `${subjectType} · ${shortId(subjectId)}${whose} [${tag}]`;
}

/**
 * The record's head, as the queue's row head reads (R55·197, 199):
 * `KIND · id · @owner [TAG]` in MONO.sm ink, the kind and tag in capitals
 * and the handle in its own case; its date muted at the right; a hairline
 * under it.
 */
export function RecordHead({
  naming,
  date,
}: Readonly<{
  naming: RecordNaming;
  /**
  The date's part name and its words ("Hidden Oct 23").
  */
  date: Readonly<{ part: string; label: string }>;
}>): JSX.Element {
  const { subjectType, subjectId, owner, tag } = naming;
  return (
    <span
      data-part="record-head"
      className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3"
    >
      <span className="min-w-0 truncate font-mono text-mono-sm text-ink">
        {/* Drawn with the kind and tag in capitals, which takes spans; heard
            as one line from the copy beside it, since spans split what a
            screen reader hears and drop the space at their edge. */}
        <span aria-hidden="true" data-part="record-name-drawn">
          <span className="uppercase">{subjectType}</span>
          {` · ${shortId(subjectId)}`}
          {owner === undefined ? undefined : ` · @${owner}`}{" "}
          <span className="uppercase">{`[${tag}]`}</span>
        </span>
        <span className="sr-only">{recordName(naming)}</span>
      </span>
      <span data-part={date.part} className="shrink-0 text-muted uppercase">
        <Mono step="xs">{date.label}</Mono>
      </span>
    </span>
  );
}
