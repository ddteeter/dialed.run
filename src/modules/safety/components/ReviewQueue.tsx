import type { JSX } from "react";
import { useState } from "react";

import { Bracketed, ListSection } from "../../../ui";
import type { QueueRow } from "../review";

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
export function ReviewQueue({
  queue,
  resolve,
}: Readonly<{
  queue: readonly QueueRow[];
  resolve: (input: {
    data: { queueId: string; decision: "approve" | "remove" };
  }) => Promise<unknown>;
}>): JSX.Element {
  // Rows leave the list as they are decided. Not optimistic in the risky
  // sense: `resolveReview` refuses a second decision on the same row, so
  // the worst case of a failed request is a row that returns on reload
  // rather than a decision that silently did not happen.
  const [decided, setDecided] = useState<readonly string[]>([]);
  const waiting = queue.filter((row) => !decided.includes(row.id));

  function decide(queueId: string, decision: "approve" | "remove"): void {
    setDecided((ids) => [...ids, queueId]);
    void resolve({ data: { queueId, decision } });
  }

  return (
    <div className="flex flex-col gap-4">
      <ListSection
        title="waiting"
        items={waiting}
        count
        whenEmpty={
          <p className="text-sm text-night/60">
            Nothing waiting. The daily digest says so too.
          </p>
        }
      >
        {(row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 border border-night/15 p-3"
          >
            <span className="text-sm font-semibold">
              {row.subjectType} · {row.subjectId}
            </span>
            <span className="text-xs text-night/60">
              <Bracketed>{row.source}</Bracketed>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-wide"
                onClick={() => {
                  decide(row.id, "approve");
                }}
              >
                Approve
              </button>
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-wide"
                onClick={() => {
                  decide(row.id, "remove");
                }}
              >
                Remove
              </button>
            </div>
          </li>
        )}
      </ListSection>
    </div>
  );
}
