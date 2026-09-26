import { Link } from "@tanstack/react-router";

import { Icon, Mono } from "../../../ui";

/**
 * The most the number says before it stops counting (round 22, item 13):
 * *"Caps at 9+."* Past nine the exact figure is not what a runner acts on.
 */
const NUMBER_CAP = 9;

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
 * `verdictsWaiting` is optional because a route that has not moved to
 * `bellStateFn` yet only knows its unread count — it gets the dot, which is
 * what an unread count honestly is.
 */
export function NotificationBell({
  unreadCount,
  verdictsWaiting = 0,
}: Readonly<{ unreadCount: number; verdictsWaiting?: number | undefined }>) {
  const mark = markOf(unreadCount, verdictsWaiting);
  const number =
    verdictsWaiting > NUMBER_CAP
      ? `${String(NUMBER_CAP)}+`
      : String(verdictsWaiting);
  // The mark is drawn, so the name has to say it: a sighted runner reads
  // "3" or a dot, and a screen reader would otherwise hear "Notifications"
  // whatever the state.
  const name: Readonly<Record<BellMark, string>> = {
    number: `Notifications, ${number} waiting for a verdict`,
    dot: "Notifications, unread",
    quiet: "Notifications",
  };

  return (
    <Link
      to="/notifications"
      aria-label={name[mark]}
      data-state={mark}
      className={`target flex items-start no-underline ${
        mark === "quiet" ? "text-muted" : "text-ink"
      }`}
    >
      <Icon name="bell" size={20} />
      {mark === "number" ? (
        <Mono
          step="xs"
          className="-ml-1.5 rounded-pill bg-action px-1 font-semibold text-ink"
        >
          {number}
        </Mono>
      ) : undefined}
      {mark === "dot" ? (
        <span className="-ml-1.5 block size-2 rounded-pill bg-action" />
      ) : undefined}
    </Link>
  );
}
