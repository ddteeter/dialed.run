import { useState } from "react";
import type { JSX } from "react";

import { spanLabel } from "../../../lib/dates";
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
import type {
  HandleReview,
  QueueRow,
  ResolveOutcome,
  ReviewSource,
} from "../review";
import { PickOne } from "./DeskForm";
import { DueClock } from "./DueClock";
import { StatutoryLine } from "./StatutoryLine";
import {
  KitOriginContext,
  kitOriginAnchor,
  useReturnToRow,
} from "./kit-origin";
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
import { reviewPhotoSrc } from "./review-photo-src";
import { shortId } from "./short-id";
import { useFocusWhen } from "./use-focus-when";
import { useSettled } from "./use-settled";
import { WhoReported, type LoadReporters } from "./WhoReported";

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
  unscreened: "not screened in a day",
  missing_file: "file missing",
};

/**
 * Why a stuck photo is here (D-157, design 167), where a reported row
 * lists what the reporters said: nobody reported it, and "Nobody reported
 * this" would leave the reviewer guessing why they are looking. The two
 * say which failure it is, because they want different things — a photo
 * the classifier never answered for can be looked at, and one whose file
 * is gone cannot.
 */
const STUCK_LINES: Readonly<Partial<Record<ReviewSource, string>>> = {
  unscreened:
    "Uploaded over a day ago and still not screened: the classifier has not answered for it. Nobody but its owner sees it while it waits.",
  missing_file:
    "Uploaded over a day ago, and its file is not in storage, so it cannot be screened or shown. Nobody but its owner sees it while it waits.",
};

/**
 * What a refused Clear photo says (owner, 2026-11-01): the photo is no
 * longer the stuck one, and a reload shows it as it is now.
 */
const CLEAR_REFUSED_LINE =
  "Nothing changed. This photo was already handled or uploaded again. Reload to see it.";

/**
 * The photos a row shows: none for a missing file, whose frame would only
 * be an image that failed to load.
 */
function photosShown(row: QueueRow): readonly string[] {
  return row.source === "missing_file" ? [] : row.subject.photoKeys;
}

/**
 * The photos a reviewer is being asked about.
 *
 * **Served from `/desk/review-photo/`, not `/feed/photo/`.** Every photo
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
          src={reviewPhotoSrc(key)}
          alt="Reported"
          className="h-32 w-auto border border-hairline"
        />
      ))}
    </span>
  );
}

/**
 * A garment photo's row (round 42 #88): the photo at F's card size — the
 * closet's photo well, not a kit photo's strip — then one MONO.xs line
 * naming the garment, so a shoe shot reads apart from a kit shot.
 */
function GarmentPhoto({
  photoKey,
  line,
}: Readonly<{ photoKey: string; line: string | undefined }>): JSX.Element {
  return (
    <>
      <span
        data-part="garment-photo"
        className="aspect-4/3 w-full rounded-field border border-hairline bg-photo wide:max-h-80"
      >
        <img
          src={reviewPhotoSrc(photoKey)}
          alt="Reported garment"
          className="h-full w-full object-contain"
        />
      </span>
      {line === undefined ? undefined : (
        // The wrapper takes the mono step's line-height too, or two lines
        // of 10px mono sit a body line apart (N3-13).
        <span
          data-part="garment-line"
          className="block text-mono-xs text-quiet"
        >
          <Mono step="xs">{line}</Mono>
        </span>
      )}
    </>
  );
}

/**
 * What a row shows of its subject: a garment's photo and line, or the
 * reported photos as a kit's are shown — and nothing for a missing file.
 */
function SubjectPhotos({ row }: Readonly<{ row: QueueRow }>): JSX.Element {
  const keys = photosShown(row);
  const [garmentKey] = keys;
  return garmentKey !== undefined && row.subjectType === "garment" ? (
    <GarmentPhoto photoKey={garmentKey} line={row.subject.garmentLine} />
  ) : (
    <ReportedPhotos keys={keys} />
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
    <span className="flex flex-col gap-1 text-small">
      {row.reporterCount === 0 ? undefined : (
        <Bracketed>
          {row.reporterCount === 1
            ? "1 person"
            : `${String(row.reporterCount)} people`}
        </Bracketed>
      )}
      <ListOfReasons reasons={row.reasons} />
    </span>
  );
}

/**
 * What the reporters said, one line. Sorted so two rows carrying the same
 * set read the same way, which is what makes a queue scannable.
 */
function reasonsLine(reasons: readonly ReportReason[]): string {
  const labels = reasons
    .map((reason) => reportReasonLabels[reason])
    .toSorted((one, other) => one.localeCompare(other));
  return labels.length === 0 ? "Nobody reported this." : labels.join(" · ");
}

function ListOfReasons({
  reasons,
}: Readonly<{ reasons: readonly ReportReason[] }>): JSX.Element {
  return <span className="text-quiet">{reasonsLine(reasons)}</span>;
}

type Decide = (input: {
  data: ReviewActionValues;
}) => Promise<{ outcome: ResolveOutcome }>;

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
 * (`RemovalDecision`), sent by the queue row's id. A missing file has
 * nothing to approve, so it offers Clear photo instead (D-157).
 *
 * **A refused Clear photo is not a failure** (D-157): `not_found` there is
 * the server declining to clear a photo that is no longer the stuck one —
 * screened since, or a garment's re-uploaded within the day — and the row
 * is still open. So the row stays where it is, with the owner's line in
 * place of the band and no Try again, since pressing again would only be
 * declined again; only a decision the server took takes it off the list.
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
      act={async (values) => {
        const decided = await decide({ data: values });
        return { action: values.action, outcome: decided.outcome };
      }}
      refused={{
        matches: (decided) =>
          decided.action === "clear" && decided.outcome === "not_found",
        line: CLEAR_REFUSED_LINE,
      }}
      reasonless={row.source === "missing_file" ? "clear" : "approve"}
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
      quiet={
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

/**
 * Why the row is here: a flagged handle's or a stuck photo's sentence, or
 * what the reporters said.
 */
function WhyHere({ row }: Readonly<{ row: QueueRow }>): JSX.Element {
  const line =
    row.subject.handleFlagged === true
      ? HANDLE_FLAGGED_LINE
      : STUCK_LINES[row.source];
  if (line === undefined) return <ReportedFor row={row} />;
  return (
    // The same step and tone as what reporters said, its neighbour's
    // line of the same kind (N3-13).
    <p data-part="why-here" className="m-0 text-small text-quiet">
      {line}
    </p>
  );
}

function rowKind(row: QueueRow): string {
  return row.subject.handleFlagged === true
    ? "handle · re-check"
    : subjectWord(row.subjectType);
}

/**
 * What a row's head names it by (R55·197): the subject's label, or, where
 * the subject has none and its id stands in, that id at its first and
 * last four characters.
 */
function headName(row: QueueRow, label: string): string {
  return label === row.subjectId ? shortId(label) : label;
}

/**
 * The row's head (R55·197): `KIND · id · @owner [SOURCE]` in MONO.sm. The
 * kind and the source in capitals; the id and the handle in their own case,
 * since a handle is never shouted (G-19). The whole name is the title.
 */
function RowHead({
  row,
  label,
}: Readonly<{ row: QueueRow; label: string }>): JSX.Element {
  const { owner } = row.subject;
  return (
    <span
      data-part="row-head"
      title={label}
      className="truncate font-mono text-mono-sm"
    >
      {/* The separators outside the capitals' span: a space at its end is
          dropped from what is heard ("photo ·01M7…"). */}
      <span className="uppercase">{rowKind(row)}</span>
      {` · ${headName(row, label)}`}
      {owner === undefined ? undefined : ` · @${owner}`}{" "}
      <span data-part="source" className="uppercase">
        {`[${SOURCE_TAGS[row.source]}]`}
      </span>
    </span>
  );
}

/**
 * What a closed row says in one line (R55·197): why the row is here, as
 * the open row's reason line says it. A guess at the words where the board
 * wrote its own (recorded in design-deltas): the open row's sentence, cut
 * to the line.
 */
function rowSummary(row: QueueRow): string {
  if (row.subject.handleFlagged === true) return HANDLE_FLAGGED_LINE;
  const stuck = STUCK_LINES[row.source];
  if (stuck !== undefined) return stuck;
  const people =
    row.reporterCount === 0
      ? []
      : [
          row.reporterCount === 1
            ? "1 person"
            : `${String(row.reporterCount)} people`,
        ];
  return [...people, reasonsLine(row.reasons)].join(" · ");
}

/**
 * The row's age or clock, at the head's right (R55·197). A row an
 * intimate-image report started carries the TAKE IT DOWN Act's 48 hours,
 * in bold hi-viz, and once they run out OVERDUE as a filled hi-viz tag;
 * every other row, how long it has waited.
 */
function RowClock({
  row,
  asOf,
}: Readonly<{ row: QueueRow; asOf: number }>): JSX.Element {
  return row.due === undefined ? (
    <Mono step="xs" className="text-muted">
      {spanLabel(asOf - row.createdAt)}
    </Mono>
  ) : (
    <DueClock
      due={row.due}
      isOverdue={row.dueAt !== undefined && row.dueAt <= asOf}
    />
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
    decideMatch: DecideMatch | undefined;
    reporters: LoadReporters | undefined;
    asOf: number;
  }>;

/**
 * The WHO REPORTED fold, for a row that has reporters and a way to read
 * them.
 */
function ReportersFold({
  row,
  reporters,
}: Readonly<{
  row: QueueRow;
  reporters: LoadReporters | undefined;
}>): JSX.Element | undefined {
  if (reporters === undefined || row.reporterCount === 0) return;
  return (
    <WhoReported queueId={row.id} count={row.reporterCount} load={reporters} />
  );
}

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
  reporters,
  asOf,
  onSettled,
}: ReviewRowProps): JSX.Element {
  const opener = useFocusWhen(active && focusOnOpen);
  // A flagged handle's header re-reads to the handle a rename lost to
  // (round 38 #60); the row stays open.
  const [label, setLabel] = useState(row.subject.label ?? row.subjectId);
  const origin = { from: "report", row: row.id } as const;

  return (
    <li
      id={kitOriginAnchor(origin)}
      tabIndex={-1}
      className="flex flex-col rounded-card border border-hairline bg-panel"
    >
      <KitOriginContext value={origin}>
        {/* R55·197: the whole head strip is the button, and the row opens
            in place. */}
        <button
          ref={opener}
          type="button"
          aria-expanded={active}
          onClick={onActivate}
          className="flex min-h-target w-full cursor-pointer items-center justify-between gap-4 border-none bg-transparent px-4 py-3 text-left text-ink"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <RowHead row={row} label={label} />
            {active ? undefined : (
              <span
                data-part="row-summary"
                className="truncate text-small text-quiet"
              >
                {rowSummary(row)}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-4 whitespace-nowrap">
            <RowClock row={row} asOf={asOf} />
            {/* The fold's own mark, as WHO REPORTED's (G-21). */}
            <span aria-hidden="true" className="text-muted">
              {active ? "▾" : "▸"}
            </span>
          </span>
        </button>
        {active ? (
          <OpenRow
            row={row}
            reads={{ reporters, decideMatch }}
            decision={
              <RowDecision
                row={row}
                decide={decide}
                reviewHandle={reviewHandle}
                onSettled={onSettled}
                onMoved={setLabel}
              />
            }
          />
        ) : undefined}
      </KitOriginContext>
    </li>
  );
}

/**
 * An open row's body and bar (R55·197, 198), each under a hairline: the
 * photo beside the reasons from `desk`; then why the row is here, the
 * statutory line directly under it (R47·126), who reported, the same
 * runner's other photos and the matches just above the bar; then the
 * decision.
 */
function OpenRow({
  row,
  reads,
  decision,
}: Readonly<{
  row: QueueRow;
  /**
  The WHO REPORTED fold's read and a garment match's decision, if any.
  */
  reads: Pick<ReviewRowProps, "reporters" | "decideMatch">;
  decision: JSX.Element;
}>): JSX.Element {
  const { reporters, decideMatch } = reads;
  return (
    <>
      <div
        data-part="row-body"
        className="flex flex-col gap-4 border-t border-hairline p-4 desk:grid desk:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] desk:items-start desk:gap-6"
      >
        <div className="flex flex-col gap-2 empty:hidden">
          <SubjectPhotos row={row} />
          <RemovedMatchLine match={row.removedMatches?.[0]} />
        </div>
        <div className="flex flex-col gap-3 desk:col-start-2">
          <WhyHere row={row} />
          {row.due === undefined ? undefined : <StatutoryLine />}
          {/* D1: who reported, folded; opening it is logged (D-164). */}
          <ReportersFold row={row} reporters={reporters} />
          <OtherPhotos others={row.otherPhotos} />
          <PhotoMatches
            found={row.photoMatches}
            removed={row.removedMatches}
            decide={decideMatch}
          />
        </div>
      </div>
      <div data-part="row-bar" className="border-t border-hairline px-4 py-3">
        {decision}
      </div>
    </>
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
    /**
     * The WHO REPORTED fold's read, which logs the look (D-164); without
     * it, a row offers no fold.
     */
    reporters?: LoadReporters | undefined;
    /**
     * After a row is decided: the route reloads, so the heading's count
     * and the rail's say what is now true.
     */
    onDecided: () => void;
    /**
    When the page was read, for each row's age (R55·197).
    */
    asOf: number;
  }>,
): JSX.Element {
  // Rows leave the list as they are decided; `useSettled` says why that
  // is safe.
  const { remaining: waiting, settle } = useSettled(props.queue, queueRowId);
  const [chosen, setChosen] = useState<string | undefined>();
  // Back from a kit, the row it was opened from is open and focused
  // (round 52 #155.5).
  useReturnToRow("report", setChosen);
  // True once a decision has landed: from then on, the row that opens
  // next takes focus, as round 28 #8 draws.
  const [hasDecided, setHasDecided] = useState(false);
  const activeId = waiting.some((row) => row.id === chosen)
    ? chosen
    : waiting[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      {/* No count of its own: Review's heading carries it (round 44
        #106), and `onDecided` keeps that one current (G-07). */}
      <ListSection
        title="waiting"
        items={waiting}
        hasCards
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
            reporters={props.reporters}
            asOf={props.asOf}
            onSettled={(id) => {
              // The row that takes the decided one's place opens next —
              // the one after it, or the one before when it was the last
              // — so a reviewer working down the list keeps their place
              // rather than being sent back to the top.
              const at = waiting.findIndex((other) => other.id === id);
              setChosen((waiting[at + 1] ?? waiting[at - 1])?.id);
              setHasDecided(true);
              settle(id);
              props.onDecided();
            }}
          />
        )}
      </ListSection>
    </div>
  );
}
