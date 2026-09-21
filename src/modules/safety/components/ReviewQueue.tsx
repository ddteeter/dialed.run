import type { JSX } from "react";

import { Bracketed, ListSection, Mono } from "../../../ui";
import { reportReasonLabels } from "../contracts";
import type { ReportReason } from "../contracts";
import type { QueueRow } from "../review";
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

export function ReviewQueue({
  queue,
  resolve,
}: Readonly<{
  queue: readonly QueueRow[];
  resolve: (input: {
    data: { queueId: string; decision: "approve" | "remove" };
  }) => Promise<unknown>;
}>): JSX.Element {
  // Rows leave the list as they are decided; `useSettled` says why that
  // is safe.
  const { remaining: waiting, settle } = useSettled(queue, (row) => row.id);

  function decide(queueId: string, decision: "approve" | "remove"): void {
    settle(queueId);
    void resolve({ data: { queueId, decision } });
  }

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
          <li
            key={row.id}
            className="flex flex-col gap-2 border border-hairline p-3"
          >
            <span className="text-body font-semibold">
              {row.subjectType} · {row.subject.label ?? row.subjectId}
            </span>
            <ReportedPhotos keys={row.subject.photoKeys} />
            <ReportedFor row={row} />
            <span className="text-micro text-quiet">
              <Bracketed>{row.source}</Bracketed>
            </span>
            <div className="flex gap-2">
              <button
                className="target"
                type="button"
                onClick={() => {
                  decide(row.id, "approve");
                }}
              >
                <Mono step="xs">Approve</Mono>
              </button>
              <button
                className="target"
                type="button"
                onClick={() => {
                  decide(row.id, "remove");
                }}
              >
                <Mono step="xs">Remove</Mono>
              </button>
            </div>
          </li>
        )}
      </ListSection>
    </div>
  );
}
