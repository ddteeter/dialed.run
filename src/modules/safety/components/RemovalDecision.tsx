import { useEffect, useState } from "react";
import type { JSX, ReactNode, Ref } from "react";
import type { z } from "zod";

import { Mono, SubmitButton, useFormSubmit, useReturnFocus } from "../../../ui";
import type { FormShell } from "../../../ui";
import {
  removalReasonSchema,
  removalReasons,
  removalStatements,
} from "../contracts";
import type { RemovalReason } from "../contracts";
import type { ReviewSubjectType } from "../review";
import { DeskForm, PickOne } from "./DeskForm";

/**
 * The Desk's decision to take something down, lifted out of the review
 * queue so a garment photo found by copy search (R-167, design 159) is
 * decided with the very bar a garment row has: a reason, **Remove**, and
 * **Remove as suspected CSAM**, which asks again in place.
 */

/**
 * A reason, as the Desk lists them: the sentence the author will read.
 * Keyed by value so `ChoiceField` shows the words and submits the key.
 */
const REASON_LABELS: Readonly<Record<RemovalReason, string>> =
  removalStatements;

/**
A decision that needs no reason: a text button beside the row's submit.
*/
export function QuietAction({
  label,
  onPress,
  buttonRef,
}: Readonly<{
  label: string;
  onPress: () => void;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
}>): JSX.Element {
  return (
    <button ref={buttonRef} className="target" type="button" onClick={onPress}>
      <Mono step="xs">{label}</Mono>
    </button>
  );
}

/**
 * A review row's decision bar: a reasonless decision first, the one that
 * takes the picked reason as the submit, and anything after it — the same
 * frame for a content row and a flagged handle's (D-97).
 */
export function DecisionForm(
  props: Readonly<{
    form: FormShell;
    onSubmit: () => void;
    first: ReactNode;
    submit: { label: string; pendingLabel: string };
    last?: ReactNode;
    children: ReactNode;
  }>,
): JSX.Element {
  const { form, submit } = props;
  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-2"
      onSubmit={props.onSubmit}
      action={
        <div className="flex flex-wrap gap-2">
          {props.first}
          <SubmitButton
            label={submit.label}
            pendingLabel={submit.pendingLabel}
            pending={form.pending}
          />
          {props.last}
        </div>
      }
    >
      {props.children}
    </DeskForm>
  );
}

/**
 * What a subject is called on the Desk: its type, except a garment's
 * photo (design 157), which the decision is about rather than the garment
 * — the garment stays in its owner's closet whatever is decided.
 */
export function subjectWord(subjectType: ReviewSubjectType): string {
  return subjectType === "garment" ? "garment photo" : subjectType;
}

/**
 * The values a decision sends, before the subject that names it: Approve,
 * or a takedown with the picked reason.
 */
type Choice =
  | { action: "approve" }
  | { action: "remove" | "quarantine"; reason: RemovalReason | undefined };

/**
 * One subject, and what a reviewer can do with it (task 128 · SAF-5).
 * **Remove deletes** it and tells its author why; **Remove as suspected
 * CSAM** does the same but keeps one copy out of every route's reach for
 * the preservation period, and tells nobody. Both need a reason — it is
 * the statement the author is sent. **Approve** is offered where something
 * queued the subject; a copy-search match has nothing to approve.
 *
 * **Suspected CSAM asks again, in place** (round 28 #8): the decision bar
 * gives way to the question, with Cancel focused, because there is no
 * undo afterwards and this is the only check. The question says only
 * what happens (D-88): a quarantine never closes the uploader's account.
 *
 * `subject` names the subject in what is sent — a queue row's id, or a
 * garment's — and `schema` is the server function's own, so the reason's
 * refusal is its sentence. `onSettled` runs only once the server has said
 * so: a remove that failed must stay where the reviewer can try again.
 */
export function RemovalDecision<TSchema extends z.ZodType>(
  props: Readonly<{
    schema: TSchema;
    subject: Readonly<Record<string, string>>;
    act: (values: z.output<TSchema>) => Promise<unknown>;
    canApprove: boolean;
    subjectType: ReviewSubjectType;
    owner: string | undefined;
    onSettled: () => void;
  }>,
): JSX.Element {
  // Nothing chosen is `undefined`, which the schema refuses with its own
  // message; the select sees it as the "—" option's value.
  const [reason, setReason] = useState<RemovalReason | undefined>();
  const [isAsking, setIsAsking] = useState(false);
  // Cancel in the question puts focus back on the press that asked it,
  // drawn afresh with the decision bar — not on the page.
  const askedFrom = useReturnFocus();
  const form = useFormSubmit({
    carry: "page",
    schema: props.schema,
    action: props.act,
    onSuccess: props.onSettled,
    successMessage: "Decided.",
  });

  function send(choice: Choice): void {
    void form.submit({ ...props.subject, ...choice });
  }

  if (isAsking) {
    return (
      <CsamQuestion
        form={form}
        subjectType={props.subjectType}
        owner={props.owner}
        onConfirm={() => {
          send({ action: "quarantine", reason });
        }}
        onCancel={() => {
          setIsAsking(false);
          askedFrom.restore();
        }}
      />
    );
  }

  return (
    <DecisionForm
      form={form}
      onSubmit={() => {
        send({ action: "remove", reason });
      }}
      first={
        props.canApprove ? (
          <QuietAction
            label="Approve"
            onPress={() => {
              send({ action: "approve" });
            }}
          />
        ) : undefined
      }
      submit={{ label: "Remove", pendingLabel: "Removing" }}
      last={
        <QuietAction
          label="Remove as suspected CSAM"
          buttonRef={askedFrom.ref}
          onPress={() => {
            // A press with no reason goes to the form, which refuses it
            // with the schema's own sentence on the field — asking a
            // question whose answer would only be refused after is worse.
            if (removalReasonSchema.safeParse(reason).success) {
              setIsAsking(true);
            } else {
              send({ action: "quarantine", reason });
            }
          }}
        />
      }
    >
      <PickOne<RemovalReason>
        name="reason"
        label="Why it comes down"
        options={removalReasons}
        optionLabels={REASON_LABELS}
        schema={removalReasonSchema}
        value={reason}
        onChange={setReason}
        field={form.field}
        error={form.fieldErrors.reason}
      />
    </DecisionForm>
  );
}

/**
 * Round 28 #8's second press: "Remove this photo everywhere and keep the
 * evidence for the report?" · Remove and report / Cancel, in place of the
 * decision bar, **with Cancel focused** — so a reviewer who pressed by
 * mistake is one Enter from safety, never from the quarantine.
 *
 * Round 28's first draft said "close @n8's account"; that is not here
 * (D-88): removing suspected CSAM does not close the account, and the
 * question says what happens. Round 29 #3 adds the quiet line under it,
 * "@n8's account stays open. Closing it is a separate action on their
 * Runners page.", so the operator does not assume it was closed — said
 * when the author's handle is known. The same form, so a quarantine that
 * fails shows its band here, with Try again beside the question.
 */
function CsamQuestion({
  form,
  subjectType,
  owner,
  onConfirm,
  onCancel,
}: Readonly<{
  form: FormShell;
  subjectType: ReviewSubjectType;
  owner: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}>): JSX.Element {
  // State rather than a ref, so the effect runs once the button exists.
  const [cancel, setCancel] = useState<HTMLButtonElement | undefined>();
  useEffect(() => {
    cancel?.focus();
  }, [cancel]);

  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-2"
      onSubmit={onConfirm}
      action={
        <div className="flex flex-wrap gap-2">
          <SubmitButton
            label="Remove and report"
            pendingLabel="Removing"
            pending={form.pending}
          />
          <button
            ref={(node) => {
              setCancel(node ?? undefined);
            }}
            className="target"
            type="button"
            onClick={onCancel}
          >
            <Mono step="xs">Cancel</Mono>
          </button>
        </div>
      }
    >
      <Mono step="xs">Remove as suspected CSAM</Mono>
      <p className="m-0 text-body">
        Remove this {subjectWord(subjectType)} everywhere and keep the evidence
        for the report?
      </p>
      {owner === undefined ? undefined : (
        <p className="m-0 text-small text-quiet">
          @{owner}&apos;s account stays open. Closing it is a separate action on
          their Runners page.
        </p>
      )}
    </DeskForm>
  );
}
