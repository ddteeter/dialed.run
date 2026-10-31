import { useCallback, useState } from "react";
import type { JSX } from "react";

import { Bracketed, ListSection, Mono, useFormSubmit } from "../../../ui";
import {
  renameReasonSchema,
  renameReasons,
  reportReasonLabels,
} from "../contracts";
import type { RenameReason, ReportReason } from "../contracts";
import {
  handleReviewInput,
  reviewActionInput,
  type HandleReviewValues,
  type ReviewActionValues,
} from "../inputs";
import type { HandleReview, QueueRow, ReviewSource } from "../review";
import { PickOne } from "./DeskForm";
import { OtherPhotos } from "./OtherPhotos";
import {
  PhotoMatches,
  RemovedMatchLine,
  type DecideMatch,
} from "./PhotoMatches";
import { RENAME_LABELS, renameMessage } from "./DeskRunners";
import { NotRenamedBand } from "./NotRenamedBand";
import {
  DecisionForm,
  QuietAction,
  RemovalDecision,
  subjectWord,
} from "./RemovalDecision";
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
 * What started a row, as its tag says it. A held upload names what was
 * done rather than the technique (round 41 #84): `[held on upload]`, not
 * `[fingerprint]`. Keyed by the stored value, so a new source is a type
 * error here until it has words.
 */
const SOURCE_TAGS: Readonly<Record<ReviewSource, string>> = {
  reports: "reports",
  classifier: "classifier",
  fingerprint: "held on upload",
};

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
A flagged handle's rename lost a race: the handle as it is now.
*/
type Moved = (username: string) => void;

/**
 * A content row's decision: Approve, Remove, or Remove as suspected CSAM
 * (`RemovalDecision`), sent by the queue row's id.
 */
function Decision({
  row,
  decide,
  onSettled,
}: RowSettleProps & Readonly<{ decide: Decide }>): JSX.Element {
  return (
    <RemovalDecision
      schema={reviewActionInput}
      subject={{ queueId: row.id }}
      act={(values) => decide({ data: values })}
      canApprove
      subjectType={row.subjectType}
      owner={row.subject.owner}
      onSettled={() => {
        onSettled(row.id);
      }}
    />
  );
}

export type ReviewHandle = (input: {
  data: HandleReviewValues;
}) => Promise<HandleReview>;

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
  onMoved,
}: RowSettleProps &
  Readonly<{ reviewHandle: ReviewHandle; onMoved: Moved }>): JSX.Element {
  const [reason, setReason] = useState<RenameReason | undefined>();
  const [said, setSaid] = useState("");
  const form = useFormSubmit({
    carry: "page",
    schema: handleReviewInput,
    action: (values) => reviewHandle({ data: values }),
    onSuccess: (review) => {
      // Neither settled the row: a taken placeholder, or a handle that
      // changed before the rename landed (R-121), which the row's header
      // re-reads to (round 38 #60).
      if (review.outcome === "moved") {
        setSaid(renameMessage({ kind: "moved", username: review.username }));
        onMoved(review.username);
        return;
      }
      if (review.outcome === "taken") {
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
      {said === "" ? undefined : <NotRenamedBand message={said} />}
    </DecisionForm>
  );
}

/**
 * A flagged handle's row says why it is there (round 35 #45): the kicker
 * names the re-check where a content row names its kind, and this line
 * stands where a content row lists what the reporters said.
 */
const HANDLE_FLAGGED_LINE =
  "The hourly re-check flagged a handle this runner already has. Nothing is hidden while it waits.";

function rowKind(row: QueueRow): string {
  return row.subject.handleFlagged === true
    ? "handle · re-check"
    : subjectWord(row.subjectType);
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
    decideMatch: DecideMatch | undefined;
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
  decideMatch,
  onSettled,
}: ReviewRowProps): JSX.Element {
  const opener = useFocusWhen(active && focusOnOpen);
  // A flagged handle's header re-reads to the handle a rename lost to
  // (round 38 #60); the row stays open.
  const [label, setLabel] = useState(row.subject.label ?? row.subjectId);

  return (
    <li className="flex flex-col gap-2 border border-hairline p-3">
      <span className="flex items-baseline justify-between gap-3">
        <button
          ref={opener}
          type="button"
          aria-expanded={active}
          onClick={onActivate}
          className="target cursor-pointer border-none bg-transparent p-0 text-left text-body font-semibold text-ink"
        >
          {rowKind(row)} · {label}
        </button>
        {/* The TAKE IT DOWN Act's 48 hours, on a row an intimate-image
            report started: in the header, right, where the age sits
            (round 35 #58b). The brackets stay about people. */}
        {row.due === undefined ? undefined : (
          <span data-part="due" className="text-ink uppercase">
            <Mono step="xs">{row.due}</Mono>
          </span>
        )}
      </span>
      <ReportedPhotos keys={row.subject.photoKeys} />
      <RemovedMatchLine match={row.removedMatches?.[0]} />
      <OtherPhotos others={row.otherPhotos} />
      <PhotoMatches
        found={row.photoMatches}
        removed={row.removedMatches}
        decide={decideMatch}
      />
      {row.subject.handleFlagged === true ? (
        <p data-part="why-here" className="m-0 text-body">
          {HANDLE_FLAGGED_LINE}
        </p>
      ) : (
        <ReportedFor row={row} />
      )}
      <span className="text-micro text-quiet">
        <Bracketed>{SOURCE_TAGS[row.source]}</Bracketed>
      </span>
      {active ? (
        <RowDecision
          row={row}
          decide={decide}
          reviewHandle={reviewHandle}
          onSettled={onSettled}
          onMoved={setLabel}
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
    Readonly<{ decide: Decide; reviewHandle: ReviewHandle; onMoved: Moved }>,
): JSX.Element {
  const { row, onSettled } = props;
  if (row.subject.handleFlagged === true) {
    return (
      <HandleDecision
        row={row}
        reviewHandle={props.reviewHandle}
        onSettled={onSettled}
        onMoved={props.onMoved}
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
    /**
     * Takes down a garment photo copy search found (design 159); without
     * it, a garment match is shown and offers nothing.
     */
    decideMatch?: DecideMatch | undefined;
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
            decideMatch={props.decideMatch}
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
