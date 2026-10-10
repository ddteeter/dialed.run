import { useCallback, useEffect, useState } from "react";
import type { JSX, ReactNode, Ref } from "react";

import {
  Bracketed,
  ListSection,
  Mono,
  SubmitButton,
  useFormSubmit,
  useReturnFocus,
} from "../../../ui";
import type { FormShell } from "../../../ui";
import {
  removalReasonSchema,
  removalReasons,
  removalStatements,
  renameReasonSchema,
  renameReasons,
  reportReasonLabels,
} from "../contracts";
import type { RemovalReason, RenameReason, ReportReason } from "../contracts";
import {
  handleReviewInput,
  reviewActionInput,
  type HandleReviewValues,
  type ReviewActionValues,
} from "../inputs";
import type { HandleReviewOutcome, QueueRow } from "../review";
import { DeskForm, PickOne } from "./DeskForm";
import { RENAME_LABELS, renameMessage } from "./DeskRunners";
import { useSettled } from "./use-settled";

/**
 * The admin review queue. **Undesigned surface** — there is no artboard
 * for it, so this follows CLAUDE.md's placeholder protocol: existing `ui/`
 * primitives, brand tokens and bracket-notation text only. No new glyph,
 * colour, font or motion, and a row in `docs/design-deltas.md`'s open
 * queue so the design round-trip tracks it.
 *
 * It is also the one surface in this lane seen by exactly one person, so
 * the shape is a worklist rather than a dashboard: what is waiting, oldest
 * first, and two buttons. Counts, charts and filters would be
 * inventing work.
 *
 * **Why the source is shown.** A photo the classifier flagged and an entry
 * three people objected to want different attention — one is a threshold
 * question, the other is a judgement about people — and a reviewer who
 * cannot tell them apart treats both the same way.
 */
/**
 * The photos a reviewer is being asked about.
 *
 * **Served from `/safety/review-photo/`, not `/feed/photo/`.** Every photo
 * in this queue is hidden precisely because it was reported, so the
 * ordinary route refuses it — which for a while meant the one subject
 * that most needs looking at was the one nothing showed.
 *
 * Nothing is rendered when there is none: a product name and a display
 * name are the whole content of their own rows, and an empty frame on
 * those reads as an image that failed to load.
 */
function ReportedPhotos({
  keys,
}: Readonly<{ keys: readonly string[] }>): JSX.Element | undefined {
  if (keys.length === 0) return undefined;
  return (
    <span className="flex flex-wrap gap-2">
      {keys.map((key) => (
        <img
          key={key}
          src={`/safety/review-photo/${key}`}
          alt="Reported photo"
          className="h-32 w-auto border border-hairline"
        />
      ))}
    </span>
  );
}

/**
 * What the reporters said, and how many of them said it.
 *
 * **This is the row's only content.** Everything else on it is an
 * identifier: a subject type and a ULID tell a reviewer nothing about
 * what they are being asked to decide, and Approve on an opaque id is not
 * a judgement. The sentences are the reporters' own — `reportReasons` is
 * one table of stored value and runner-facing label, so this reads the
 * label rather than restating it.
 *
 * A classifier-sourced row has nobody behind it and says so, rather than
 * rendering "[0 people]" and an empty list.
 */
function ReportedFor({ row }: Readonly<{ row: QueueRow }>): JSX.Element {
  return (
    <span className="flex flex-col gap-1 text-micro">
      <Bracketed>
        {row.reporterCount === 1
          ? "1 person"
          : `${String(row.reporterCount)} people`}
      </Bracketed>
      {/* Design 136: the TAKE IT DOWN Act's 48 hours, on a row an
          intimate-image report started (design deltas item 57). */}
      {row.due === undefined ? undefined : <Bracketed>{row.due}</Bracketed>}
      <ListOfReasons reasons={row.reasons} />
    </span>
  );
}

function ListOfReasons({
  reasons,
}: Readonly<{ reasons: readonly ReportReason[] }>): JSX.Element {
  // Sorted so two rows carrying the same set read the same way, which is
  // what makes a queue scannable.
  const labels = reasons
    .map((reason) => reportReasonLabels[reason])
    .toSorted((one, other) => one.localeCompare(other));
  return (
    <span className="text-quiet">
      {labels.length === 0 ? "Nobody reported this." : labels.join(" · ")}
    </span>
  );
}

/**
 * A reason, as the Desk lists them: the sentence the author will read.
 * Keyed by value so `ChoiceField` shows the words and submits the key.
 */
const REASON_LABELS: Readonly<Record<RemovalReason, string>> =
  removalStatements;

type Decide = (input: { data: ReviewActionValues }) => Promise<unknown>;

/**
 * What every row-level decision form needs, whatever decides it: the row
 * itself and the callback that takes it off the waiting list. Named once so
 * `Decision` and `HandleDecision` state the one thing they share instead of
 * each restating it.
 */
type RowSettleProps = Readonly<{
  row: QueueRow;
  onSettled: (id: string) => void;
}>;

/**
A decision that needs no reason: a text button beside the row's submit.
*/
function QuietAction({
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
function DecisionForm(
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
 * One row, and the three things a reviewer can do with it (task 128 ·
 * SAF-5). **Remove deletes** the entry or photo and tells its author why;
 * **Remove as suspected CSAM** does the same but keeps one copy out of
 * every route's reach for the preservation period. Both need a reason —
 * it is the statement the author is sent — and Approve does not.
 *
 * **Suspected CSAM asks again, in the row** (round 28 #8): the decision
 * bar gives way to the question, with Cancel focused, because there is
 * no undo afterwards and this is the only check. The question says only
 * what happens (D-88): a quarantine never closes the uploader's account.
 *
 * The row leaves the list only once the server has said so: a remove
 * that failed must stay where the reviewer can try it again.
 */
function Decision({
  row,
  decide,
  onSettled,
}: RowSettleProps & Readonly<{ decide: Decide }>): JSX.Element {
  // Nothing chosen is `undefined`, which the schema refuses with its own
  // message; the select sees it as the "—" option's value.
  const [reason, setReason] = useState<RemovalReason | undefined>();
  const [isAsking, setIsAsking] = useState(false);
  // Cancel in the question puts focus back on the press that asked it,
  // drawn afresh with the decision bar — not on the page.
  const askedFrom = useReturnFocus();
  const form = useFormSubmit({
    schema: reviewActionInput,
    action: (values) => decide({ data: values }),
    onSuccess: () => {
      onSettled(row.id);
    },
    successMessage: "Decided.",
  });

  function send(action: "remove" | "quarantine"): void {
    void form.submit({ queueId: row.id, action, reason });
  }

  if (isAsking) {
    return (
      <CsamQuestion
        form={form}
        subjectType={row.subjectType}
        owner={row.subject.owner}
        onConfirm={() => {
          send("quarantine");
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
        send("remove");
      }}
      first={
        <QuietAction
          label="Approve"
          onPress={() => {
            void form.submit({ queueId: row.id, action: "approve" });
          }}
        />
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
              send("quarantine");
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
  subjectType: QueueRow["subjectType"];
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
        Remove this {subjectType} everywhere and keep the evidence for the
        report?
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

export type ReviewHandle = (input: {
  data: HandleReviewValues;
}) => Promise<{ outcome: HandleReviewOutcome }>;

/**
 * A handle the re-ask flagged (D-97): **Keep** — the handle is fine, and
 * the flag clears — or **Rename**, D8's force-rename with its reasons
 * list, after which the runner meets O0's "USERNAME CHANGED BY A
 * MODERATOR". No Remove: removing a person is a ban, and a name is not a
 * reason to close an account. A drawn placeholder somebody holds keeps
 * the row, with D8's sentence for it.
 */
function HandleDecision({
  row,
  reviewHandle,
  onSettled,
}: RowSettleProps & Readonly<{ reviewHandle: ReviewHandle }>): JSX.Element {
  const [reason, setReason] = useState<RenameReason | undefined>();
  const [said, setSaid] = useState("");
  const form = useFormSubmit({
    schema: handleReviewInput,
    action: (values) => reviewHandle({ data: values }),
    onSuccess: ({ outcome }) => {
      if (outcome === "taken") {
        setSaid(renameMessage({ kind: "taken" }));
        return;
      }
      onSettled(row.id);
    },
    successMessage: "Decided.",
  });

  return (
    <DecisionForm
      form={form}
      onSubmit={() => {
        void form.submit({
          queueId: row.id,
          action: "rename",
          nameReason: reason,
        });
      }}
      first={
        <QuietAction
          label="Keep"
          onPress={() => {
            void form.submit({ queueId: row.id, action: "keep" });
          }}
        />
      }
      submit={{ label: "Rename", pendingLabel: "Renaming" }}
    >
      <PickOne<RenameReason>
        name="nameReason"
        label="Why the name has to go"
        options={renameReasons}
        optionLabels={RENAME_LABELS}
        schema={renameReasonSchema}
        value={reason}
        onChange={setReason}
        field={form.field}
        error={form.fieldErrors.nameReason}
      />
      {said === "" ? undefined : <p className="text-body">{said}</p>}
    </DecisionForm>
  );
}

/**
 * `ReviewRow`'s props, named rather than inlined at the call site:
 * `RowSettleProps` plus the two things round 28 #8 added
 * (`active`/`focusOnOpen`/`onActivate`) and the two decision callbacks a
 * row may need.
 */
type ReviewRowProps = RowSettleProps &
  Readonly<{
    active: boolean;
    focusOnOpen: boolean;
    onActivate: () => void;
    decide: Decide;
    reviewHandle: ReviewHandle;
  }>;

/**
 * A waiting row. Only the row being decided carries the decision, so the
 * page holds one reason picker — and a reviewer decides one thing at a
 * time, the oldest first unless they pick another.
 *
 * **The row itself opens** (round 28 #8: "one row opens at a time into a
 * decision bar"): its name is the button, where a separate "Decide this
 * one" used to sit under every closed row. After a decision, focus moves
 * to the next row, which opens — `focusOnOpen` is that hand-over, and it
 * is never set on first paint, so arriving on the page moves nothing.
 */
function ReviewRow({
  row,
  active,
  focusOnOpen,
  onActivate,
  decide,
  reviewHandle,
  onSettled,
}: ReviewRowProps): JSX.Element {
  const opener = useFocusWhen(active && focusOnOpen);

  return (
    <li className="flex flex-col gap-2 border border-hairline p-3">
      <button
        ref={opener}
        type="button"
        aria-expanded={active}
        onClick={onActivate}
        className="target cursor-pointer self-start border-none bg-transparent p-0 text-left text-body font-semibold text-ink"
      >
        {row.subjectType} · {row.subject.label ?? row.subjectId}
      </button>
      <ReportedPhotos keys={row.subject.photoKeys} />
      <ReportedFor row={row} />
      <span className="text-micro text-quiet">
        <Bracketed>{row.source}</Bracketed>
      </span>
      {active ? (
        <RowDecision
          row={row}
          decide={decide}
          reviewHandle={reviewHandle}
          onSettled={onSettled}
        />
      ) : undefined}
    </li>
  );
}

/**
 * The decision a row offers: a flagged handle's Keep and Rename, or the
 * content decision every other row takes.
 */
function RowDecision(
  props: RowSettleProps &
    Readonly<{ decide: Decide; reviewHandle: ReviewHandle }>,
): JSX.Element {
  const { row, onSettled } = props;
  if (row.subject.handleFlagged === true) {
    return (
      <HandleDecision
        row={row}
        reviewHandle={props.reviewHandle}
        onSettled={onSettled}
      />
    );
  }
  return <Decision row={row} decide={props.decide} onSettled={onSettled} />;
}

/**
 * A ref callback that focuses its element when `shouldFocus` is, and
 * changes only with it: React calls it with the element when it changes,
 * so focus moves once — when the element becomes the one to land on — and
 * not on every render after.
 */
function useFocusWhen(
  shouldFocus: boolean,
): (node: HTMLElement | null) => void {
  return useCallback(
    (node: HTMLElement | null) => {
      if (shouldFocus && node !== null) node.focus();
    },
    [shouldFocus],
  );
}

/**
 * The empty queue's line. Once a decision has emptied it, focus lands
 * here — the reviewer's last row is gone, and focus with it, so this is
 * the place that says what is now true. Focusable by script only: it is
 * a sentence, not a control.
 */
function NothingWaiting({
  hasDecided,
}: Readonly<{ hasDecided: boolean }>): JSX.Element {
  const line = useFocusWhen(hasDecided);
  return (
    <p ref={line} tabIndex={-1} className="text-small text-quiet">
      Nothing waiting. The daily digest says so too.
    </p>
  );
}

/**
A queue row's identity, for `useSettled`.
*/
function queueRowId(row: QueueRow): string {
  return row.id;
}

export function ReviewQueue(
  props: Readonly<{
    queue: readonly QueueRow[];
    resolve: Decide;
    reviewHandle: ReviewHandle;
  }>,
): JSX.Element {
  // Rows leave the list as they are decided; `useSettled` says why that
  // is safe.
  const { remaining: waiting, settle } = useSettled(props.queue, queueRowId);
  const [chosen, setChosen] = useState<string | undefined>();
  // True once a decision has landed: from then on, the row that opens
  // next takes focus, as round 28 #8 draws.
  const [hasDecided, setHasDecided] = useState(false);
  const activeId = waiting.some((row) => row.id === chosen)
    ? chosen
    : waiting[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <ListSection
        title="waiting"
        items={waiting}
        count
        whenEmpty={<NothingWaiting hasDecided={hasDecided} />}
      >
        {(row) => (
          <ReviewRow
            key={row.id}
            row={row}
            active={row.id === activeId}
            focusOnOpen={hasDecided}
            onActivate={() => {
              setChosen(row.id);
            }}
            decide={props.resolve}
            reviewHandle={props.reviewHandle}
            onSettled={(id) => {
              // The row that takes the decided one's place opens next —
              // the one after it, or the one before when it was the last
              // — so a reviewer working down the list keeps their place
              // rather than being sent back to the top.
              const at = waiting.findIndex((other) => other.id === id);
              setChosen((waiting[at + 1] ?? waiting[at - 1])?.id);
              setHasDecided(true);
              settle(id);
            }}
          />
        )}
      </ListSection>
    </div>
  );
}
