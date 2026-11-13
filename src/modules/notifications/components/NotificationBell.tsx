import { Link } from "@tanstack/react-router";

import { Icon, Mono } from "../../../ui";
import { BELL_NUMBER_CAP } from "../bell-cap";
import type { BellState } from "../bell-state";

/**
 * A count as the bell draws it: digits, and `9+` past the cap (round 22,
 * item 13; round 26 #9: "The count is in digits").
 */
function capped(count: number): string {
  return count > BELL_NUMBER_CAP
    ? `${String(BELL_NUMBER_CAP)}+`
    : String(count);
}

/**
 * A count as the bell's name says it: the digits, and past the cap the
 * words round 27 #25 gives — "more than 9" — since "9+" read aloud is
 * "nine plus" (R-141(1)).
 */
function spoken(count: number): string {
  return count > BELL_NUMBER_CAP
    ? `more than ${String(BELL_NUMBER_CAP)}`
    : String(count);
}

type BellMark = "number" | "dot" | "quiet";

/**
 * Which of S2a's three states the bell is in. The number wins over the dot
 * when both apply (round 22, item 13).
 */
function markOf(unreadCount: number, verdictsWaiting: number): BellMark {
  if (verdictsWaiting > 0) return "number";
  return unreadCount > 0 ? "dot" : "quiet";
}

/**
 * S2a's three states, as round 22 assigned them (item 13):
 *
 * - **A number** when runs are waiting for a verdict — *"It's a number
 *   because each one is a thing to do."*
 * - **A dot** for anything else unread — follows, useful, system notes.
 * - **Nothing** otherwise, and the glyph steps back to `--muted`.
 *
 * The count is as fresh as the page's own load (server-first per
 * CLAUDE.md). The glyph is the pack's `bell`, never an emoji, and it never
 * animates: *"the bell never rings, shakes or bounces. It changes state and
 * stops."*
 *
 * Both counts are required (FEED-3): every route loads `bellStateFn`, so
 * no bell is left able to draw only the dot.
 */
export function NotificationBell({
  unreadCount,
  verdictsWaiting,
}: Readonly<BellState>) {
  const mark = markOf(unreadCount, verdictsWaiting);
  const number = capped(verdictsWaiting);
  // The mark is drawn, so the name has to say it: a sighted runner reads
  // "3" or a dot, and a screen reader would otherwise hear "Notifications"
  // whatever the state. Round 26 #9 names two: "Notifications" and
  // "Notifications, 3 new". The dot has no drawn name; it says how many
  // unread rows it stands for, in the same words.
  const name: Readonly<Record<BellMark, string>> = {
    number: `Notifications, ${spoken(verdictsWaiting)} new`,
    dot: `Notifications, ${spoken(unreadCount)} new`,
    quiet: "Notifications",
  };

  return (
    <Link
      to="/notifications"
      aria-label={name[mark]}
      data-state={mark}
      // Centred in its 44 target, as the search glyph beside it is, so the
      // desk bar's right-hand three share one line (#632) and the phone
      // seat's glyph ends on the gutter (Design 169.1, `PhoneBell`). The
      // mark rides the glyph's corner from a box of its own rather than
      // lifting the glyph with it: `items-start` did that, and the bell
      // sat 12px high.
      className={`target flex items-center justify-center no-underline ${
        mark === "quiet" ? "text-muted" : "text-ink"
      }`}
    >
      <span data-slot="bell-glyph" className="relative flex">
        <Icon name="bell" size={20} />
        {mark === "number" ? (
          <Mono
            step="xs"
            className="absolute top-0 left-3.5 rounded-pill bg-action px-1 font-semibold text-accent-ink"
          >
            {number}
          </Mono>
        ) : undefined}
        {mark === "dot" ? (
          <span className="absolute top-0 left-3.5 block size-2 rounded-pill bg-action" />
        ) : undefined}
      </span>
    </Link>
  );
}
