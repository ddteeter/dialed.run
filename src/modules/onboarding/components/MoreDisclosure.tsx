import type { JSX } from "react";
import { Icon } from "../../../ui";

/**
 * "Everything else · N more" — the fold O3 and P2.5 both use.
 *
 * One component because both screens are long lists a runner should be
 * able to skim, and the second copy arrived by paste: semantic dupes
 * called them a 32-line clone, correctly.
 *
 * **The label states the real remainder**, never a number baked into a
 * design (§AA rule 03). **And it renders nothing when nothing is
 * hidden**, because a disclosure over an empty set is a control that lies.
 *
 * **Open, it reads "Fewer"** (round 22, item 25): *"Expanded folds are the
 * same rows, continued, with 'Fewer' at the end. No second style for the
 * revealed part."* It already sits after the rows, so opening the fold
 * puts the revealed rows above it and the control at their end.
 * `aria-expanded` still carries the state, so the name change is the
 * label a sighted runner reads and not the only signal.
 *
 * **Not a pill** (R61·334.2): an underlined text button with the pack's
 * `forward` glyph after its words, as /open-source's disclosures are
 * (R58·290). The glyph turns down while the fold is open.
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
      className="target inline-flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-small text-ink underline underline-offset-4"
    >
      {expanded ? "Fewer" : `Everything else · ${String(remaining)} more`}
      <Icon
        name="forward"
        size={16}
        className={expanded ? "rotate-90" : "rotate-0"}
      />
    </button>
  );
}
