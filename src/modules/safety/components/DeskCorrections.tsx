import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";
import type { z } from "zod";

import {
  correctionDecisionSchema,
  DECLINE_REASON_LABELS,
  DECLINE_REASONS,
  declineReasonSchema,
} from "../../../lib/contracts/product-corrections";
import type {
  CorrectionField,
  DeclineReason,
} from "../../../lib/contracts/product-corrections";
import { valueWords } from "../../../lib/correction-words";
import { monthDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  FailureBand,
  Mono,
  QUIET_CANCEL,
  useFormSubmit,
} from "../../../ui";
import type {
  ApplyOutcome,
  CorrectionFiler,
  CorrectionGroup,
  CorrectionsQueue,
} from "../../products";
import { DeskForm, PickOne } from "./DeskForm";
import { QuietAction } from "./RemovalDecision";

/**
 * How a field and its values read on the Desk. Not the runner sheet's
 * words, which live with closet; the Desk names the field as the queue
 * row's kicker does, and a value as the product stores it.
 */
const FIELD_KICKER: Readonly<Record<CorrectionField, string>> = {
  name: "Name",
  weight: "Weight",
  fabric: "Fabric",
  wind: "Wind",
  water: "Water",
  composition: "Composition",
  link: "Link",
};

type Key = Pick<CorrectionGroup, "productId" | "field" | "value">;

export interface DeskCorrectionsProps {
  queue: CorrectionsQueue;
  apply: (input: { data: Key }) => Promise<ApplyOutcome>;
  decline: (input: {
    data: Key & { reason: DeclineReason };
  }) => Promise<unknown>;
}

/**
 * The Desk's Corrections queue (D-163, R48·130): one row per product,
 * field and suggested value, with the runners who sent it, most runners
 * first. Apply (chalk) writes the product; Decline (outline) asks for one
 * of three reasons inline, then Confirm. No Merge. Product names and notes
 * are runner-typed, so they are only ever React text.
 */
export function DeskCorrections({
  queue,
  apply,
  decline,
}: Readonly<DeskCorrectionsProps>): JSX.Element {
  return (
    <section aria-labelledby="desk-corrections" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1
          id="desk-corrections"
          className="m-0 font-display text-title uppercase"
        >
          Corrections
        </h1>
        <Bracketed step="xs" className="text-muted">
          {`${String(queue.waiting)} waiting · ${String(queue.decidedToday)} decided today`}
        </Bracketed>
      </div>
      {queue.groups.length === 0 ? (
        <p className="m-0">
          <Mono step="sm" className="text-muted">
            No corrections waiting.
          </Mono>
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {queue.groups.map((group) => (
            <CorrectionRow
              key={`${group.productId}:${group.field}:${group.value}`}
              group={group}
              apply={apply}
              decline={decline}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function CorrectionRow({
  group,
  apply,
  decline,
}: Readonly<{
  group: CorrectionGroup;
  apply: DeskCorrectionsProps["apply"];
  decline: DeskCorrectionsProps["decline"];
}>): JSX.Element {
  const key = {
    productId: group.productId,
    field: group.field,
    value: group.value,
  };
  const title = `${group.brandName} · ${group.productName}`;
  return (
    <li>
      <article
        aria-label={title}
        className="flex flex-col gap-3 border border-hairline bg-panel p-4"
      >
        <Mono step="xs" className="text-muted">
          {FIELD_KICKER[group.field]} · {counted(group.filers.length, "runner")}{" "}
          · oldest {monthDayLabel(group.firstAt)}
        </Mono>
        <h2 className="m-0 text-body font-bold wrap-anywhere">{title}</h2>
        <NowAndSuggested group={group} />
        <Filers filers={group.filers} />
        <DecisionBar subject={key} apply={apply} decline={decline} />
      </article>
    </li>
  );
}

/**
 * NOW and SUGGESTED, as the board's two cells. A product that says
 * nothing for the field has "Not stated" for now.
 */
function NowAndSuggested({
  group,
}: Readonly<{ group: CorrectionGroup }>): JSX.Element {
  return (
    // One layout for every card, a value of any length: label and value on
    // one line each, the labels in one column and the values in another
    // (G-20, N3-15).
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
      <div className="contents">
        <dt className="text-muted">
          <Mono step="xs">Now</Mono>
        </dt>
        <dd className="m-0 text-body wrap-anywhere">
          {group.now === undefined
            ? "Not stated"
            : valueWords(group.field, group.now)}
        </dd>
      </div>
      <div className="contents">
        <dt className="text-muted">
          <Mono step="xs">Suggested</Mono>
        </dt>
        <dd className="m-0 text-body font-bold wrap-anywhere">
          {valueWords(group.field, group.value)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The newest runner and their note lead; "N more runners" opens the rest
 * inline (R48·130).
 */
function Filers({
  filers,
}: Readonly<{ filers: readonly CorrectionFiler[] }>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rest = filers.slice(1);
  const shown = isOpen ? filers : filers.slice(0, 1);
  return (
    <div className="flex flex-col gap-1">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((filer, index) => (
          <FilerLine key={index} filer={filer} />
        ))}
      </ul>
      {isOpen || rest.length === 0 ? undefined : (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setIsOpen(true);
          }}
          className="target cursor-pointer self-start border-none bg-transparent p-0 text-small font-semibold text-ink underline underline-offset-4"
        >
          {counted(rest.length, "more runner")}
        </button>
      )}
    </div>
  );
}

function FilerLine({
  filer,
}: Readonly<{ filer: CorrectionFiler }>): JSX.Element {
  const who = filer.handle === null ? "A deleted runner" : `@${filer.handle}`;
  return (
    <li className="text-small wrap-anywhere">
      {who} · {monthDayLabel(filer.createdAt)}
      {filer.note === null ? undefined : <> · &ldquo;{filer.note}&rdquo;</>}
    </li>
  );
}

/**
 * Apply (chalk), with Decline beside it. A name another product of the
 * brand has is refused, not failed: the line says what to do instead.
 */
/**
 * Sends a decision to its server function. Decline has nothing to refuse,
 * so it answers as applied.
 */
async function decide(
  values: z.output<typeof correctionDecisionSchema>,
  apply: DeskCorrectionsProps["apply"],
  decline: DeskCorrectionsProps["decline"],
): Promise<ApplyOutcome> {
  const key = {
    productId: values.productId,
    field: values.field,
    value: values.value,
  };
  if (values.decision === "apply") return apply({ data: key });
  await decline({ data: { ...key, reason: values.reason } });
  return { applied: true };
}

const NAME_TAKEN_LINE =
  "Another product of this brand already has that name. Decline it, and look in Duplicates.";

/**
 * The row's decision, one form: Apply (chalk) with Decline beside it, and
 * Decline's inline select, "No reason given" by default, then Confirm or
 * Cancel. A name another product of the brand has is refused, not failed:
 * the line says what to do instead.
 */
function DecisionBar({
  subject,
  apply,
  decline,
}: Readonly<{
  subject: Key;
  apply: DeskCorrectionsProps["apply"];
  decline: DeskCorrectionsProps["decline"];
}>): JSX.Element {
  const router = useRouter();
  const [isDeclining, setIsDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | undefined>("none");
  const [refusedLine, setRefusedLine] = useState<string | undefined>();
  const form = useFormSubmit({
    carry: "page",
    schema: correctionDecisionSchema,
    action: (values) => decide(values, apply, decline),
    onSuccess: () => router.invalidate(),
    successMessage: isDeclining ? "Declined." : "Applied.",
    refusal: {
      matches: (result) => !result.applied,
      answer: () => {
        setRefusedLine(NAME_TAKEN_LINE);
      },
    },
  });
  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-2"
      onSubmit={() => {
        setRefusedLine(undefined);
        void form.submit(
          isDeclining
            ? { ...subject, decision: "decline", reason }
            : { ...subject, decision: "apply" },
        );
      }}
      submit={
        isDeclining
          ? { label: "Confirm", pendingLabel: "Declining" }
          : { label: "Apply", pendingLabel: "Applying" }
      }
      also={
        isDeclining ? (
          <button
            type="button"
            className={`target ${QUIET_CANCEL}`}
            onClick={() => {
              setIsDeclining(false);
            }}
          >
            Cancel
          </button>
        ) : (
          <QuietAction
            label="Decline"
            onPress={() => {
              // The refusal was Apply's; it is not a hint about Decline's
              // select (G-20).
              setRefusedLine(undefined);
              setIsDeclining(true);
            }}
          />
        )
      }
    >
      {isDeclining ? (
        <PickOne<DeclineReason>
          name="reason"
          label="Reason"
          options={DECLINE_REASONS}
          optionLabels={DECLINE_REASON_LABELS}
          schema={declineReasonSchema}
          value={reason}
          onChange={setReason}
          field={form.field}
          error={form.fieldErrors.reason}
        />
      ) : undefined}
      {/* A refusal reads as every other one on the Desk: a kicker over
          the sentence (G-20; NOT APPLIED, owner 2026-11-12). */}
      {refusedLine === undefined ? undefined : (
        <div role="status">
          <FailureBand
            kicker="Not applied"
            message={refusedLine}
            state="refused"
          />
        </div>
      )}
    </DeskForm>
  );
}
