import type { JSX } from "react";

/**
 * "Everything else · N more" — the fold O3 and P2.5 both use.
 *
 * One component because both screens are long lists a runner should be
 * able to skim, and the second copy arrived by paste: semantic dupes
 * called them a 32-line clone, correctly.
 *
 * **The label states the real remainder**, never a number baked into a
 * design (§AA rule 03). **It does not change when it opens** —
 * `aria-expanded` carries the state, and a control whose accessible name
 * flips announces itself as a different control each press. **And it
 * renders nothing when nothing is hidden**, because a disclosure over an
 * empty set is a control that lies.
 */
export function MoreDisclosure({
  remaining,
  expanded,
  onToggle,
}: Readonly<{
  remaining: number;
  expanded: boolean;
  onToggle: () => void;
}>): JSX.Element | undefined {
  if (remaining === 0) return undefined;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="cursor-pointer self-start rounded-full border border-dashed border-night/30 bg-transparent px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-night/60"
    >
      Everything else · {remaining} more
      <span aria-hidden="true"> ▾</span>
    </button>
  );
}
