import type { ReactNode } from "react";

/**
 * A display headline in pink brackets — `[ NOBODY YET ]`, `[ NO RUNS YET ]`,
 * `[ FINDING WEATHER ]` — the way round 22 draws an empty or waiting state
 * that has a next step.
 *
 * **`pending` makes the brackets breathe**, and nothing else moves: the
 * Motion Doctrine's waiting device (*"no spinners or skeleton shimmer —
 * brackets breathe instead"*), the same one `PendingLabel` uses. The
 * brackets are hidden from a screen reader either way; the words are the
 * headline.
 */
export function BracketHeadline({
  children,
  pending = false,
}: Readonly<{ children: ReactNode; pending?: boolean }>) {
  const bracket = pending ? "breathe text-action" : "text-action";
  return (
    <p className="m-0 flex gap-2 font-display text-display uppercase">
      <span aria-hidden="true" className={bracket}>
        [
      </span>
      <span>{children}</span>
      <span aria-hidden="true" className={bracket}>
        ]
      </span>
    </p>
  );
}
