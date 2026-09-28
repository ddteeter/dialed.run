import { Bracketed } from "../../../ui";

/**
 * D-62's marker (FEED-6), placeholder until designed: the author's own
 * entry that reports have hidden pending review. Only the author is ever
 * shown one — nobody else can reach the entry (D-67). On the card and on
 * D, so one component: two spellings of a marker drift.
 */
export function UnderReview() {
  return (
    <p data-part="under-review" className="m-0 text-muted">
      <Bracketed>Under review</Bracketed>
    </p>
  );
}
