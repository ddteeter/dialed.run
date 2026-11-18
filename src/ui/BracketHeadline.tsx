import type { ReactNode } from "react";

type HeadlineStep = "display" | "title";

const STEP_CLASS: Readonly<Record<HeadlineStep, string>> = {
  display: "m-0 font-display text-display uppercase",
  title: "m-0 font-display text-title uppercase",
};

/**
 * A display headline in pink brackets — `[ NOBODY YET ]`, `[ NO RUNS YET ]`,
 * `[ FINDING WEATHER ]` — the way round 22 draws an empty or waiting state
 * that has a next step.
 *
 * **`pending` makes the brackets breathe**, and nothing else moves: the
 * Motion Doctrine's waiting device (*"no spinners or skeleton shimmer —
 * brackets breathe instead"*), the same one `PendingLabel` uses. The
 * brackets are hidden from a screen reader either way; the words are the
 * headline, and an `<h2>` under the screen's own `<h1>`: drawn as a
 * headline, it is announced as one (axe's `p-as-heading`, plan 161).
 *
 * `step` is the type step: `display` for a screen's empty state, `title`
 * for one inside a panel, as the bell's `[ QUIET ]`.
 */
export function BracketHeadline({
  children,
  pending = false,
  step = "display",
}: Readonly<{
  children: ReactNode;
  pending?: boolean;
  step?: HeadlineStep | undefined;
}>) {
  // Inline, not a flex row (E1-06): words that wrap take the line they
  // need, and each bracket stays with the word beside it, with no
  // whitespace between them. A flex row gave the words the whole width
  // and flung the closing bracket to the far edge. The same mechanism as
  // `PendingLabel`'s pending layer.
  const opening = pending ? "breathe mr-2 text-action" : "mr-2 text-action";
  const closing = pending ? "breathe ml-2 text-action" : "ml-2 text-action";
  return (
    <h2 className={STEP_CLASS[step]}>
      <span aria-hidden="true" className={opening}>
        [
      </span>
      {children}
      <span aria-hidden="true" className={closing}>
        ]
      </span>
    </h2>
  );
}
