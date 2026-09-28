import { useState } from "react";
import type { JSX } from "react";

import {
  Bracketed,
  ChoiceField,
  ListSection,
  Mono,
  NO_CHOICE,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import {
  removalReasonSchema,
  removalReasons,
  removalStatements,
  reportReasonLabels,
} from "../contracts";
import type { RemovalReason, ReportReason } from "../contracts";
import { reviewActionInput, type ReviewActionValues } from "../inputs";
import type { QueueRow } from "../review";
import { DeskForm } from "./DeskForm";
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
 * One row, and the three things a reviewer can do with it (task 128 ·
 * SAF-5). **Remove deletes** the entry or photo and tells its author why;
 * **Remove as suspected CSAM** does the same but keeps one copy out of
 * every route's reach for the preservation period. Both need a reason —
 * it is the statement the author is sent — and Approve does not.
 *
 * The row leaves the list only once the server has said so: a remove
 * that failed must stay where the reviewer can try it again.
 */
function Decision({
  row,
  decide,
  onSettled,
}: Readonly<{
  row: QueueRow;
  decide: Decide;
  onSettled: (id: string) => void;
}>): JSX.Element {
  // Nothing chosen is `undefined`, which the schema refuses with its own
  // message; the select sees it as the "—" option's value.
  const [reason, setReason] = useState<RemovalReason | undefined>();
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

  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-2"
      onSubmit={() => {
        send("remove");
      }}
      action={
        <div className="flex flex-wrap gap-2">
          <button
            className="target"
            type="button"
            onClick={() => {
              void form.submit({ queueId: row.id, action: "approve" });
            }}
          >
            <Mono step="xs">Approve</Mono>
          </button>
          <SubmitButton
            label="Remove"
            pendingLabel="Removing"
            pending={form.pending}
          />
          <button
            className="target"
            type="button"
            onClick={() => {
              send("quarantine");
            }}
          >
            <Mono step="xs">Remove as suspected CSAM</Mono>
          </button>
        </div>
      }
    >
      <ChoiceField<RemovalReason>
        name="reason"
        label="Why it comes down"
        options={removalReasons}
        optionLabels={REASON_LABELS}
        value={reason ?? NO_CHOICE}
        onChange={(picked) => {
          setReason(removalReasonSchema.safeParse(picked).data);
        }}
        field={form.field}
        error={form.fieldErrors.reason}
      />
    </DeskForm>
  );
}

/**
 * A waiting row. Only the row being decided carries the decision, so the
 * page holds one reason picker — and a reviewer decides one thing at a
 * time, the oldest first unless they pick another.
 */
function ReviewRow({
  row,
  active,
  onActivate,
  decide,
  onSettled,
}: Readonly<{
  row: QueueRow;
  active: boolean;
  onActivate: () => void;
  decide: Decide;
  onSettled: (id: string) => void;
}>): JSX.Element {
  return (
    <li className="flex flex-col gap-2 border border-hairline p-3">
      <span className="text-body font-semibold">
        {row.subjectType} · {row.subject.label ?? row.subjectId}
      </span>
      <ReportedPhotos keys={row.subject.photoKeys} />
      <ReportedFor row={row} />
      <span className="text-micro text-quiet">
        <Bracketed>{row.source}</Bracketed>
      </span>
      {active ? (
        <Decision row={row} decide={decide} onSettled={onSettled} />
      ) : (
        <button
          className="target self-start"
          type="button"
          onClick={onActivate}
        >
          <Mono step="xs">Decide this one</Mono>
        </button>
      )}
    </li>
  );
}

/**
A queue row's identity, for `useSettled`.
*/
function queueRowId(row: QueueRow): string {
  return row.id;
}

export function ReviewQueue(
  props: Readonly<{ queue: readonly QueueRow[]; resolve: Decide }>,
): JSX.Element {
  // Rows leave the list as they are decided; `useSettled` says why that
  // is safe.
  const { remaining: waiting, settle } = useSettled(props.queue, queueRowId);
  const [chosen, setChosen] = useState<string | undefined>();
  const activeId = waiting.some((row) => row.id === chosen)
    ? chosen
    : waiting[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <ListSection
        title="waiting"
        items={waiting}
        count
        whenEmpty={
          <p className="text-small text-quiet">
            Nothing waiting. The daily digest says so too.
          </p>
        }
      >
        {(row) => (
          <ReviewRow
            key={row.id}
            row={row}
            active={row.id === activeId}
            onActivate={() => {
              setChosen(row.id);
            }}
            decide={props.resolve}
            onSettled={settle}
          />
        )}
      </ListSection>
    </div>
  );
}
