import type { JSX } from "react";
import { useState } from "react";

import {
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
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

  // "them" rather than a name when there is nobody to name. The artboard
  // writes the handle inline; keeping the fallback in one place stops the
  // copy reading "Block  as well" on a subject that has no author.
  const them = subject.authorName ?? "them";

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
            alsoBlock: canBlock ? alsoBlock : undefined,
          });
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <FormErrorSummary
          rows={form.summaryRows}
          summaryRef={form.summaryRef}
          onFocusField={form.focusField}
        />

        <h2 className="text-lg font-semibold">Report this entry</h2>
        <p className="text-xs text-night/60">{subject.label}</p>

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

        <section className="flex flex-col gap-1 text-xs text-night/60">
          <h3 className="font-semibold uppercase tracking-wide">
            What happens next
          </h3>
          <p>
            A person reads it within a day. The entry is hidden from your feed
            straight away, whatever we decide. {them} is never told who
            reported it.
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

        {canBlock ? (
          <ToggleField
            name="alsoBlock"
            label={`Block ${them} as well`}
            isOn={alsoBlock}
            onChange={setAlsoBlock}
            field={form.field}
          />
        ) : undefined}
      </form>
    </Sheet>
  );
}
