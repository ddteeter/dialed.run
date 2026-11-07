import type { JSX } from "react";
import { useEffect, useState } from "react";

import {
  CORRECTION_FIELDS,
  CORRECTION_NOTE_COUNTER_FROM,
  CORRECTION_NOTE_MAX,
  fileCorrectionSchema,
  yesNoSchema,
} from "../../../lib/contracts/product-corrections";
import { fabricSchema, weightSchema } from "../../../lib/contracts";
import type { CorrectionField } from "../../../lib/contracts/product-corrections";
import { monthDayLabel } from "../../../lib/dates";
import {
  ChoiceField,
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Icon,
  Mono,
  Sheet,
  SheetReceipt,
  SubmitButton,
  TextField,
  useFormSubmit,
  useIdempotencyKey,
} from "../../../ui";
import type { FieldProps } from "../../../ui";
import { valueWords } from "../../../lib/correction-words";
import {
  FABRIC_LABELS,
  WEIGHT_LABELS,
  YES_NO_LABELS,
} from "../../../lib/garment-words";

/**
 * What the sheet is correcting: the shared product, and the runner's own
 * garment it was opened from, which the outcome's bell row opens.
 */
export interface CorrectionSubject {
  productId: string;
  garmentId: string;
}

/**
 * What the sheet reads when it opens, as the server answers it: the
 * product, what it says now per field, and the runner's own waiting
 * corrections on it.
 */
export interface CorrectionContextRow {
  brandName: string;
  productName: string;
  current: Partial<Record<CorrectionField, string>>;
  waiting: readonly WaitingCorrectionRow[];
}

export interface WaitingCorrectionRow {
  field: CorrectionField;
  value: string;
  createdAt: number;
}

/**
 * The field choice's words, in the sheet's order (R48·129a).
 */
export const CORRECTION_FIELD_LABELS: Readonly<
  Record<CorrectionField, string>
> = {
  name: "Name",
  weight: "Weight",
  fabric: "Fabric",
  wind: "Wind",
  water: "Water",
  composition: "Composition",
  link: "Link",
};

/**
 * The value input's label, which quotes what the product says now
 * (R48·129a: "IT SAYS MID. IT SHOULD SAY").
 */
export function valueLabel(
  field: CorrectionField,
  current: string | undefined,
): string {
  return current === undefined
    ? "It should say"
    : `It says ${valueWords(field, current)}. It should say`;
}

export interface CorrectionSheetProps {
  open: boolean;
  onClose: () => void;
  subject: CorrectionSubject;
  /**
  Asked for when the sheet opens, never with the page.
  */
  loadContext: (input: {
    data: { productId: string };
  }) => Promise<CorrectionContextRow>;
  fileCorrection: (input: {
    data: {
      productId: string;
      garmentId: string;
      field: CorrectionField;
      value: string;
      note?: string | undefined;
      idempotencyKey: string;
    };
  }) => Promise<unknown>;
}

/**
 * §AG's WRONG? sheet (D-163, R48·129). Like Report: pick one of seven
 * fields, then an input of its type, an optional "How do you know?", and
 * the receipt swaps in place. A field with a correction already waiting
 * opens prefilled with it and says so; sending again replaces it
 * (R48·129c). It needs a confirmed address, which the server says and the
 * root answers.
 */
export function CorrectionSheet(
  props: Readonly<CorrectionSheetProps>,
): JSX.Element {
  const { open, onClose } = props;
  const [isReceipt, setIsReceipt] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={isReceipt ? "Correction sent" : "What's wrong with it?"}
    >
      {isReceipt ? (
        <CorrectionReceipt onDone={onClose} />
      ) : (
        <CorrectionForm
          {...props}
          onSent={() => {
            setIsReceipt(true);
          }}
        />
      )}
    </Sheet>
  );
}

const NO_CONTEXT: CorrectionContextRow = {
  brandName: "",
  productName: "",
  current: {},
  waiting: [],
};

function useCorrectionContext(
  isOpen: boolean,
  productId: string,
  load: CorrectionSheetProps["loadContext"],
): CorrectionContextRow {
  const [context, setContext] = useState(NO_CONTEXT);
  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    async function read(): Promise<void> {
      try {
        const answer = await load({ data: { productId } });
        if (isCurrent) setContext(answer);
      } catch {
        // Law 5: the kicker, the quote and the waiting line are courtesies,
        // so a failed read leaves the sheet without them, still sendable.
      }
    }
    void read();
    return () => {
      isCurrent = false;
    };
  }, [isOpen, productId, load]);
  return context;
}

function CorrectionForm({
  open,
  onClose,
  subject,
  loadContext,
  fileCorrection,
  onSent,
}: Readonly<CorrectionSheetProps & { onSent: () => void }>): JSX.Element {
  const [field, setField] = useState<CorrectionField | undefined>();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const { idempotencyKey } = useIdempotencyKey();
  const context = useCorrectionContext(open, subject.productId, loadContext);
  const form = useFormSubmit({
    carry: "page",
    schema: fileCorrectionSchema,
    action: (values) => fileCorrection({ data: values }),
    onSuccess: onSent,
    successMessage: "Correction sent.",
    labels: {
      field: "Field",
      value: "It should say",
      note: "How do you know?",
    },
    confirmTrigger: "correct",
  });
  const sent = context.waiting.find((row) => row.field === field);
  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({
          ...subject,
          field,
          value,
          note: note === "" ? undefined : note,
          idempotencyKey,
        });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        summaryRef={form.summaryRef}
        onFocusField={form.focusField}
      />
      <ProductKicker context={context} />
      <SheetHead title="What's wrong with it?" onClose={onClose} />
      <p className="m-0 text-small text-quiet">
        This fixes it for every runner. Your own garment keeps what you entered.
      </p>
      <ChoiceList<CorrectionField>
        name="field"
        legend="Field"
        options={CORRECTION_FIELDS}
        optionLabels={CORRECTION_FIELD_LABELS}
        value={field}
        onChange={(picked) => {
          setField(picked);
          // A field with one waiting opens with what was sent (R48·129c).
          setValue(
            context.waiting.find((row) => row.field === picked)?.value ?? "",
          );
        }}
        field={form.field}
        error={form.fieldErrors.field}
      />
      {field === undefined ? undefined : (
        <ValueInput
          field={field}
          label={valueLabel(field, context.current[field])}
          value={value}
          onChange={setValue}
          formField={form.field}
          error={form.fieldErrors.value}
        />
      )}
      <TextField
        name="note"
        label="How do you know? · optional"
        value={note}
        onChange={setNote}
        field={form.field}
        error={form.fieldErrors.note}
        hint={<NoteCounter length={note.length} />}
        autoComplete="off"
      />
      {sent === undefined ? undefined : <SentLine row={sent} />}
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Send correction"
        pendingLabel="Sending"
        pending={form.pending}
      />
    </form>
  );
}

/**
 * `JANJI · AFO MIDDLE LAYER` (R48·129a), once the sheet has read it.
 */
function ProductKicker({
  context,
}: Readonly<{ context: CorrectionContextRow }>): JSX.Element | undefined {
  if (context.productName === "") return;
  return (
    <Mono step="xs" className="text-muted">
      {context.brandName} · {context.productName}
    </Mono>
  );
}

function SheetHead({
  title,
  onClose,
}: Readonly<{ title: string; onClose: () => void }>): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lead font-semibold">{title}</h2>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="target inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink"
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

/**
 * The input of the picked field's type (R48·129c): weight and fabric are
 * the closet form's selects, wind and water Yes / No, the rest text.
 */
function ValueInput({
  field,
  label,
  value,
  onChange,
  formField,
  error,
}: Readonly<{
  field: CorrectionField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  formField: (name: string) => FieldProps;
  error: string | undefined;
}>): JSX.Element {
  const shared = { name: "value", field: formField, error };
  if (field === "weight") {
    return (
      <ChoiceField
        {...shared}
        label={label}
        options={weightSchema.options}
        optionLabels={WEIGHT_LABELS}
        value={weightSchema.safeParse(value).data ?? ""}
        onChange={onChange}
      />
    );
  }
  if (field === "fabric") {
    return (
      <ChoiceField
        {...shared}
        label={label}
        options={fabricSchema.options}
        optionLabels={FABRIC_LABELS}
        value={fabricSchema.safeParse(value).data ?? ""}
        onChange={onChange}
      />
    );
  }
  if (field === "wind" || field === "water") {
    return (
      <ChoiceList
        {...shared}
        legend={label}
        options={yesNoSchema.options}
        optionLabels={YES_NO_LABELS}
        value={yesNoSchema.safeParse(value).data}
        onChange={onChange}
      />
    );
  }
  return (
    <TextField
      {...shared}
      label={label}
      type={field === "link" ? "url" : "text"}
      value={value}
      onChange={onChange}
      autoComplete="off"
    />
  );
}

/**
 * R48·129e: "You sent "{value}" for {field} on {date}. Sending again
 * replaces it."
 */
function SentLine({
  row,
}: Readonly<{ row: WaitingCorrectionRow }>): JSX.Element {
  const words = valueWords(row.field, row.value);
  const field = CORRECTION_FIELD_LABELS[row.field].toLowerCase();
  return (
    <p data-part="correction-waiting" className="m-0 text-small text-quiet">
      You sent &ldquo;{words}&rdquo; for {field} on{" "}
      {monthDayLabel(row.createdAt)}. Sending again replaces it.
    </p>
  );
}

/**
 * The count from 240 of 280 (R48·129c); nothing before that.
 */
export function NoteCounter({
  length,
}: Readonly<{ length: number }>): JSX.Element | undefined {
  if (length < CORRECTION_NOTE_COUNTER_FROM) return;
  return (
    <Mono step="xs">
      {length}/{CORRECTION_NOTE_MAX}
    </Mono>
  );
}

/**
 * R48·129d's receipt, swapped in place; its heading takes focus so the
 * swap is read out.
 */
function CorrectionReceipt({
  onDone,
}: Readonly<{ onDone: () => void }>): JSX.Element {
  return (
    <SheetReceipt
      part="correction-receipt"
      kicker="Correction sent"
      heading="Thanks. We'll check it."
      onDone={onDone}
    >
      <p className="m-0 text-body">
        We&apos;ll let you know here when it&apos;s fixed or if we keep it as it
        is.
      </p>
    </SheetReceipt>
  );
}
