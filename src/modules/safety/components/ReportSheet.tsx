import type { JSX } from "react";
import { useState } from "react";

import {
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Icon,
  Mono,
  Sheet,
  SubmitButton,
  TextField,
  ToggleField,
  useFormSubmit,
} from "../../../ui";
import { reportReasonLabels, reportReasons } from "../contracts";
import type { ReportReason, ReportSubjectType } from "../contracts";
import { fileReportInput } from "../inputs";

/**
 * W1 · REPORT AN ENTRY.
 *
 * **The reasons are the artboard's sentences, not policy categories.** W1's
 * own note says so: "Reasons are written as sentences a runner would say,
 * not policy categories." They come from `../contracts` rather than being
 * retyped here, so the stored value and the label a runner reads can never
 * drift apart.
 *
 * **Nothing here animates and nothing is red.** The Motion Doctrine's
 * NEVER list covers the failure path, and pink is action rather than
 * failure — `FormFailureBand` owns what a failure looks like, the same as
 * every other form in the app.
 *
 * The "what happens next" block is load-bearing copy, not reassurance: it
 * is what makes filing a report cost the reporter nothing, and each of its
 * three sentences is a promise the code keeps. A person reads it (the
 * review queue, and the digest that reports its depth). The entry is
 * hidden from your feed straight away (the report row itself is that
 * hide). They are never told who reported it (nothing in `fileReport`
 * writes a notification).
 */
/**
 * What is being reported, as one value rather than four loose props.
 *
 * They travel together — every caller has all of them or none — and a
 * component's parameter list is not a good place to keep a record that
 * already exists.
 */
export interface ReportSubject {
  type: ReportSubjectType;
  id: string;
  /**
  One line naming what is being reported, for the sheet's own heading.
  */
  label: string;
  /**
   * Whose content it is, for the copy that names them. Absent when the
   * subject has no single author a runner would recognise — a product
   * name, say — and the copy then avoids inventing one.
   */
  authorName?: string | undefined;
  /**
   * The author's id. Unused by this sheet and used by
   * `ReportAffordance`, which needs it to decide whether the viewer is
   * looking at their own thing and whether there is anybody to block. It
   * lives on the subject because that is what it is a fact about.
   */
  authorId?: string | undefined;
}

export function ReportSheet({
  open,
  onClose,
  subject,
  canBlock,
  fileReport,
  onFiled,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  subject: ReportSubject;
  /**
   * Whether to offer W1's "Block them as well". Off for a subject with no
   * author to block, and off when the viewer has already blocked them:
   * offering an action that would do nothing is worse than not offering it.
   */
  canBlock: boolean;
  fileReport: (input: {
    data: {
      subjectType: ReportSubjectType;
      subjectId: string;
      reason: ReportReason;
      note?: string | undefined;
      alsoBlock?: boolean | undefined;
    };
  }) => Promise<unknown>;
  onFiled: () => void;
}>): JSX.Element {
  // `undefined` rather than `""` for "not chosen yet": that is what
  // ChoiceList's own value type says, and it is also what the schema
  // wants — a missing reason and an empty-string reason are the same
  // fact, and having two spellings of it is how one of them gets missed.
  const [reason, setReason] = useState<ReportReason | undefined>();
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);

  const form = useFormSubmit({
    schema: fileReportInput,
    action: (values) => fileReport({ data: values }),
    onSuccess: () => {
      onFiled();
      onClose();
    },
    successMessage: "Report sent.",
    labels: { reason: "What's wrong with it", note: "Anything else" },
  });

  // **The block offer needs a name, so it is gated on having one.**
  //
  // `canBlock` and `authorName` are two props that have always had to
  // agree — the caller turns blocking off for a subject with no author —
  // and nothing made them. A caller passing `canBlock` without a name
  // rendered "Block  as well", with the gap where the handle goes. The
  // old guard against that was `authorName ?? "them"`, which is a fallback
  // for a state the component can simply refuse to be in: ask for the
  // name, and let its absence be the answer.
  //
  // That also removed a string no test could reach. Once the sentence
  // below stopped using `them` (see `neverTold`), the fallback's only
  // remaining reader was this label — which never renders without a name —
  // so the mutation gate correctly reported `"them"` as unobservable.
  const blockableName = canBlock ? subject.authorName : undefined;

  // The sentence gets its own string, because the wording changes the verb
  // as well as the word: a name is singular ("Alex is never told"), the
  // pronoun is not ("They are never told"). One string could never have
  // served both, which is how "them is never told" shipped. Raised on
  // PR #73.
  const neverTold =
    subject.authorName === undefined
      ? "They are never told who reported it."
      : `${subject.authorName} is never told who reported it.`;

  return (
    <Sheet open={open} onClose={onClose} label="Report this entry">
      <form
        ref={form.formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit({
            subjectType: subject.type,
            subjectId: subject.id,
            reason,
            note: note === "" ? undefined : note,
            alsoBlock: blockableName === undefined ? undefined : alsoBlock,
          });
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <FormErrorSummary
          rows={form.summaryRows}
          summaryRef={form.summaryRef}
          onFocusField={form.focusField}
        />

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lead font-semibold">Report this entry</h2>
          {/* W1's ✕ (round 22, item 21): "closes and discards without
              confirm". A button, not the form's reset — nothing is asked,
              and the caller mounts a fresh sheet for the next report. */}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="target inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <p className="text-micro text-quiet">{subject.label}</p>

        {/* Yes, this is valid TSX, and it is not a trick. A JSX element
            takes explicit type arguments exactly as a call does
            (TypeScript 2.9+), so `ChoiceList<ReportReason>` says which
            union this list is over. Without it inference widens `value`
            and `onChange` to `string` and the compiler stops catching a
            reason that is not one. Asked on PR #73. */}
        <ChoiceList<ReportReason>
          name="reason"
          legend="What's wrong with it"
          options={reportReasons.map((option) => option.value)}
          optionLabels={reportReasonLabels}
          value={reason}
          onChange={setReason}
          field={form.field}
          error={form.fieldErrors.reason}
        />

        <TextField
          name="note"
          label="Anything else · optional"
          value={note}
          onChange={setNote}
          field={form.field}
          error={form.fieldErrors.note}
          hint="One or two lines is plenty."
          autoComplete="off"
        />

        <section className="flex flex-col gap-1 text-micro text-quiet">
          <h3>
            <Mono step="xs">What happens next</Mono>
          </h3>
          <p>
            A person reads it within a day. The entry is hidden from your feed
            straight away, whatever we decide. {neverTold}
          </p>
        </section>

        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />

        <SubmitButton
          label="Send report"
          pendingLabel="Sending"
          pending={form.pending}
        />

        {blockableName === undefined ? undefined : (
          <ToggleField
            name="alsoBlock"
            label={`Block ${blockableName} as well`}
            isOn={alsoBlock}
            onChange={setAlsoBlock}
            field={form.field}
          />
        )}
      </form>
    </Sheet>
  );
}
