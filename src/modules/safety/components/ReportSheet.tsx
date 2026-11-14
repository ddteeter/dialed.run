import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useId, useState } from "react";

import {
  ChoiceList,
  ConfirmLink,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  SECONDARY_PILL,
  Sheet,
  SheetFooter,
  SheetReceipt,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import {
  profileReportReasonLabels,
  profileReportReasons,
  reportReasonLabels,
  reportReasons,
} from "../contracts";
import type { ReportReason, ReportSubjectType } from "../contracts";
import { fileReportInput } from "../inputs";
import type { FileReportResult } from "../reports";
import { ElsewhereHelp } from "./ElsewhereHelp";

/**
 * What each kind of sheet offers. W1 for an entry, a photo or a product;
 * R55·214's own sheet for a profile, with profile reasons only. The
 * profile's labels lay its sentences over W1's, so the one ChoiceList
 * reads a shared value ("harassment") in the profile's words.
 */
/**
 * What ChoiceList shows under a reason while it is the one picked: the
 * intimate-image reason's way out (round 37 #58k), for a runner who'd
 * rather not report from their account.
 */
const INTIMATE_DETAIL = { intimate: <IntimateHelp /> };

const SHEET_KIND = {
  entry: {
    reasons: reportReasons.map((reason): ReportReason => reason.value),
    labels: reportReasonLabels,
    legend: "What's wrong with it",
  },
  profile: {
    reasons: profileReportReasons.map((reason): ReportReason => reason.value),
    labels: { ...reportReasonLabels, ...profileReportReasonLabels },
    legend: "What's wrong",
  },
} as const;

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
  blockRunner,
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
  }) => Promise<FileReportResult>;
  /**
   * R55·214's "Block without reporting", on a profile's sheet: a block
   * with no reason, after its own confirm. Absent where there is nobody
   * to block.
   */
  blockRunner?:
    ((input: { data: { userId: string } }) => Promise<unknown>) | undefined;
  onFiled: () => void;
}>): JSX.Element {
  // `undefined` rather than `""` for "not chosen yet": that is what
  // ChoiceList's own value type says, and it is also what the schema
  // wants — a missing reason and an empty-string reason are the same
  // fact, and having two spellings of it is how one of them gets missed.
  const [reason, setReason] = useState<ReportReason | undefined>();
  const [note, setNote] = useState("");
  // Which of W1's two buttons sent it (R54·166.6), so only that one shows
  // its in-flight label. Nothing until the first send.
  const [sentBy, setSentBy] = useState<"report" | "block">();
  // Round 42: an intimate-image report swaps the sheet for its receipt
  // rather than closing, so the other sites are said where it was sent.
  const [isReceipt, setIsReceipt] = useState(false);

  function finish(): void {
    onFiled();
    onClose();
  }

  const form = useFormSubmit({
    carry: "page",
    schema: fileReportInput,
    action: (values) => fileReport({ data: values }),
    onSuccess: () => {
      if (reason === "intimate") setIsReceipt(true);
      else finish();
    },
    successMessage: "Report sent.",
    labels: { reason: "What's wrong with it", note: "Anything else" },
    // The server refuses a reporter whose address is not confirmed
    // (round 26 #11; SAF-15; D-113). Not a success — nothing was filed, so
    // "Report sent." is never said and the sheet stays as it was — and not
    // a failure either: the root opens "Confirm your email first".
    confirmTrigger: "report",
  });

  if (isReceipt) {
    // The native close hands focus back to the Report link, which leads
    // nowhere now; it moves on once that has happened (round 42).
    const closeReceipt = () => {
      finish();
      globalThis.setTimeout(focusPageHeading, 0);
    };
    return (
      <Sheet
        open={open}
        onClose={closeReceipt}
        kicker="Report sent"
        label="Thanks for telling us."
      >
        <IntimateReceipt onDone={closeReceipt} />
      </Sheet>
    );
  }

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

  // Round 26 #7 (SAF-15): the sheet names whose entry it is, by handle,
  // once there is a handle to name. A profile is the runner, not an entry
  // of theirs (owner, 2026-11-12, E1-12).
  const title = titleOf(subject);
  const isProfile = subject.type === "profile";
  const kind = SHEET_KIND[isProfile ? "profile" : "entry"];

  function send(isAlsoBlocking: boolean): void {
    // The submit guards itself, but the label would still move to the
    // other button mid-flight.
    if (form.pending) return;
    setSentBy(isAlsoBlocking ? "block" : "report");
    void form.submit({
      subjectType: subject.type,
      subjectId: subject.id,
      reason,
      note: note === "" ? undefined : note,
      alsoBlock: blockableName === undefined ? undefined : isAlsoBlocking,
    });
  }

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <form
        ref={form.formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          send(false);
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <FormErrorSummary
          rows={form.summaryRows}
          summaryRef={form.summaryRef}
          onFocusField={form.focusField}
        />

        <SubjectLine subject={subject} />

        {/* Yes, this is valid TSX, and it is not a trick. A JSX element
            takes explicit type arguments exactly as a call does
            (TypeScript 2.9+), so `ChoiceList<ReportReason>` says which
            union this list is over. Without it inference widens `value`
            and `onChange` to `string` and the compiler stops catching a
            reason that is not one. Asked on PR #73. */}
        <ChoiceList<ReportReason>
          name="reason"
          legend={kind.legend}
          options={kind.reasons}
          optionLabels={kind.labels}
          // R55·215, R37: W1's way out sits inside the chosen row, under
          // the reason's words, once that reason is picked.
          optionDetail={INTIMATE_DETAIL}
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

        <WhatHappensNext subject={subject} />

        <SheetFooter>
          <ConsequenceLine isProfile={isProfile} />
          <FormFailureBand
            failure={form.failure}
            onRetry={form.retry}
            retryRef={form.retryRef}
          />
          <SubmitButton
            label="Send report"
            pendingLabel="Sending"
            pending={form.pending && sentBy === "report"}
          />
          <BlockWays
            name={blockableName}
            pending={form.pending && sentBy === "block"}
            onSendAndBlock={() => {
              send(true);
            }}
            blockOnly={blockOnlyAct(subject.authorId, blockRunner, finish)}
          />
        </SheetFooter>
      </form>
    </Sheet>
  );
}

/**
 * W1's second way to finish (R54·166.6): "Send and block", a hairline pill
 * under Send report, with what blocking does beneath it. It replaced a
 * tick box under the primary, which a runner read past on the way to the
 * big button (audit P2b-03).
 *
 * **Its name is its words; the handle is its description.** 166.6 named it
 * "Send report and block {handle}", but a name that does not contain the
 * visible label fails WCAG 2.5.3 (axe's `label-content-name-mismatch`): a
 * voice user who says "Send and block" would not reach it. So the name is
 * "Send and block", and the line under it, which names whom it blocks, is
 * its description. A screen reader still hears both acts and the handle.
 *
 * A button rather than a second submit, so the form's own submit — Enter
 * in the note — stays plain Send report.
 */
function SendAndBlock({
  name,
  pending,
  onSend,
}: Readonly<{
  name: string;
  pending: boolean;
  onSend: () => void;
}>): JSX.Element {
  const consequenceId = useId();
  return (
    <>
      <button
        type="button"
        aria-describedby={consequenceId}
        {...inFlight(pending)}
        onClick={onSend}
        className={`target ${SECONDARY_PILL}`}
      >
        <PendingLabel
          label="Send and block"
          pendingLabel="Sending"
          pending={pending}
        />
      </button>
      <p
        id={consequenceId}
        data-part="block-consequence"
        className="m-0 text-small text-quiet"
      >
        Blocking hides all of {name}&apos;s runs from you. They aren&apos;t
        told.
      </p>
    </>
  );
}

/**
 * The line under the title, naming what is reported: an entry's run. On a
 * profile that is the handle the title already says, so it goes.
 */
function SubjectLine({
  subject,
}: Readonly<{ subject: ReportSubject }>): JSX.Element | undefined {
  return subject.type === "profile" ? undefined : (
    <p className="m-0 text-micro text-quiet">{subject.label}</p>
  );
}

/**
 * The full paragraph at the body's end on W1; the footer says it in one
 * line (R54·164.4). A profile's sheet has neither half of it: nothing is
 * hidden, and R55·214's footer says the rest.
 *
 * The last sentence gets its own string, because the wording changes the
 * verb as well as the word: a name is singular ("Alex is never told"),
 * the pronoun is not ("They are never told"). One string could never have
 * served both, which is how "them is never told" shipped. Raised on PR
 * #73.
 */
function WhatHappensNext({
  subject,
}: Readonly<{ subject: ReportSubject }>): JSX.Element | undefined {
  if (subject.type === "profile") return undefined;
  const neverTold =
    subject.authorName === undefined
      ? "They are never told who reported it."
      : `@${subject.authorName} is never told who reported it.`;
  return (
    <section className="flex flex-col gap-1 text-micro text-quiet">
      <h3>
        <Mono step="xs">What happens next</Mono>
      </h3>
      <p>
        A person reads it within a day. The entry is hidden from your feed
        straight away, whatever we decide. {neverTold}
      </p>
    </section>
  );
}

/**
 * The footer's one line of what happens: W1's, or R55·214's on a
 * profile, where nothing is hidden.
 */
function ConsequenceLine({
  isProfile,
}: Readonly<{ isProfile: boolean }>): JSX.Element {
  return (
    <p data-part="report-consequence" className="m-0 text-small text-quiet">
      {isProfile
        ? "A person reads it within a day. They won't know it was you."
        : "A person reads it within a day. It's hidden from your feed straight away."}
    </p>
  );
}

/**
 * R55·214's block with no report and no reason, as an act for its
 * confirm, or nothing where there is nobody to block or no way to.
 */
function blockOnlyAct(
  userId: string | undefined,
  blockRunner:
    ((input: { data: { userId: string } }) => Promise<unknown>) | undefined,
  onBlocked: () => void,
): (() => Promise<void>) | undefined {
  if (userId === undefined || blockRunner === undefined) return undefined;
  return async () => {
    await blockRunner({ data: { userId } });
    onBlocked();
  };
}

/**
 * The footer's ways to block, under Send report: W1's "Send and block",
 * and on a profile R55·214's third way out, "Block without reporting",
 * which asks only for its confirm, in the sheet's own block line (owner,
 * 2026-11-13).
 */
function BlockWays({
  name,
  pending,
  onSendAndBlock,
  blockOnly,
}: Readonly<{
  /**
  Whom a block would block; nothing to offer without one.
  */
  name: string | undefined;
  pending: boolean;
  onSendAndBlock: () => void;
  blockOnly: (() => Promise<void>) | undefined;
}>): JSX.Element | undefined {
  if (name === undefined) return undefined;
  return (
    <>
      <SendAndBlock name={name} pending={pending} onSend={onSendAndBlock} />
      {blockOnly === undefined ? undefined : (
        <ConfirmLink
          label="Block without reporting"
          heading={`Block @${name}?`}
          body={`Blocking hides all of @${name}'s runs from you. They aren't told.`}
          verb="Block"
          pendingVerb="Blocking"
          kicker="Not blocked"
          state="confirm-block"
          act={blockOnly}
        />
      )}
    </>
  );
}

/**
 * Under the intimate-image reason: W1's way out (round 37 #58k). Where
 * else to go waits for the receipt (round 41 #85): here it would crowd the
 * choice. Shown only once that reason is picked, inside its row.
 */
function IntimateHelp(): JSX.Element {
  return (
    <p data-part="takedown-way-out" className="m-0 text-small">
      Rather not use your account?{" "}
      <Link
        to="/takedown"
        data-target="inline"
        className="font-bold text-ink underline underline-offset-4"
      >
        Report it without signing in
      </Link>
    </p>
  );
}

/**
 * W1's receipt for an intimate-image report (round 42): what happened,
 * what we owe, then where else to go, last after a hairline. Every other
 * reason closes the sheet on "Report sent." The head takes focus, so the
 * swap is read out; Done, or Esc, closes it.
 *
 * "Within a day" is the owner's word for the board's "today" (2026-10-29):
 * the promise the sheet's own "What happens next" already makes.
 */
function IntimateReceipt({
  onDone,
}: Readonly<{ onDone: () => void }>): JSX.Element {
  return (
    <SheetReceipt part="report-receipt" onDone={onDone}>
      <p className="m-0 text-body">
        It&apos;s hidden from everyone now. We&apos;ll review it within a day
        and keep it down if it breaks the rule.
      </p>
      <ElsewhereHelp />
    </SheetReceipt>
  );
}

/**
 * Where focus goes once the receipt closes (round 42): the next item on
 * the page, else its heading. W1 opens from D and from a profile, each one
 * subject with nothing after it, so that is the heading. A heading is not
 * focusable by default, so it is made reachable by script only; no page
 * heading carries a tabindex of its own to lose.
 */
function focusPageHeading(): void {
  const heading = document.querySelector<HTMLElement>("h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
}

/**
 * The sheet's title: whose entry it is, or which runner, by handle once
 * there is one (round 26 #7; R55·214 for a profile).
 */
function titleOf(subject: ReportSubject): string {
  if (subject.authorName === undefined) return "Report this entry";
  // R55·214: a profile's own sheet, "Report or block @handle".
  return subject.type === "profile"
    ? `Report or block @${subject.authorName}`
    : `Report @${subject.authorName}'s entry?`;
}
