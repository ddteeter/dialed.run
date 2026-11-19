import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  ControlFailureBand,
  inFlight,
  INK_PILL_INLINE,
  LIST_PILL,
  PendingLabel,
  SECONDARY_PILL_INLINE,
  useControlAction,
} from "../../../ui";
import type { ControlAction } from "../../../ui";

export type FollowAction = (input: {
  data: { userId: string };
}) => Promise<unknown>;

export interface FollowToggle {
  isFollowing: boolean;
  control: ControlAction<[]>;
}

/**
 * Follow and Unfollow, as one control's state — H's header and each
 * runner-search row.
 *
 * **Round 23, item 9**: not optimistic. The label waits behind
 * `[ Following ]` or `[ Unfollowing ]` (the Accessibility Contract's
 * pair) and flips on success only; a failure names what is still true,
 * `Not following` / `Still following`. The sentence goes to the screen's
 * one status region through `onStatus`.
 *
 * **Follow waits for a confirmed address** (design 133, D-113: a
 * follower count is something other runners see); Unfollow does not. The
 * server's refusal of a Follow opens the root's "Confirm your email
 * first", and the pill stays as it was.
 *
 * A hook plus two pieces rather than one component, because the band sits
 * under the whole thing that failed: under H's pill, but under a search
 * row's full width — never squeezed beside a pill.
 */
export function useFollowToggle({
  userId,
  isFollowing: initiallyFollowing,
  follow,
  unfollow,
  onStatus,
}: Readonly<{
  userId: string;
  isFollowing: boolean;
  follow: FollowAction;
  unfollow: FollowAction;
  onStatus: (status: string) => void;
}>): FollowToggle {
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const control = useControlAction<[]>({
    // The call and the flip are paired per direction: they are two
    // endpoints, and crossing them would leave the label saying the
    // opposite of the truth.
    action: async () => {
      await (isFollowing ? unfollow : follow)({ data: { userId } });
      setIsFollowing(!isFollowing);
    },
    kicker: isFollowing ? "Still following" : "Not following",
    confirmTrigger: "follow",
  });
  const { status } = control;
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  return { isFollowing, control };
}

/**
 * The pill. On H's header Follow is the ink pill and Following the
 * hairline secondary (R61·334.3), because following again is not the
 * thing to do next; on a list row both are quieter (`PILL_LOOK`).
 *
 * **On a list row it is described by the handle** (round 52 #157,
 * D-187): heard alone, a row's pill said "Follow" and not whose. The name
 * holds only the visible word, in every state; `describedBy` is the id of
 * the row's visible handle, so whose it is comes as its description. H's
 * header passes none: its h1 names the runner.
 */
export function FollowPill({
  toggle,
  describedBy,
}: Readonly<{ toggle: FollowToggle; describedBy?: string | undefined }>) {
  const { isFollowing, control } = toggle;
  const where = describedBy === undefined ? "header" : "row";
  const label = (
    <PendingLabel
      label={isFollowing ? "Following" : "Follow"}
      pendingLabel={isFollowing ? "Unfollowing" : "Following"}
      pending={control.pending}
    />
  );
  return (
    <button
      type="button"
      {...inFlight(control.pending)}
      aria-describedby={describedBy}
      onClick={() => {
        void control.run();
      }}
      className={`target shrink-0 ${pillLook(where, isFollowing)}`}
    >
      {where === "header" ? <HeldWidth>{label}</HeldWidth> : label}
    </button>
  );
}

/**
 * One width in both states (R61·334.3: "so the row doesn't shift"). The
 * label shares a grid cell with an unseen copy of the widest words the
 * pill ever shows, in the heavier of its two weights, so Follow,
 * Following and each one's in-flight verb all sit in the same box.
 */
function HeldWidth({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="grid justify-items-center">
      <span className="[grid-area:1/1]">{children}</span>
      <span
        aria-hidden="true"
        data-part="held-width"
        className="invisible font-bold [grid-area:1/1]"
      >
        <PendingLabel
          label="Following"
          pendingLabel="Unfollowing"
          pending={false}
        />
      </span>
    </span>
  );
}

/**
 * The pill's look. On H's header, Follow is the ink pill and Following
 * `SECONDARY_PILL`'s hairline (R61·334.3), each without a column's width
 * rule, since the pill sits beside a name; 48 high, the ink pill's own
 * height (the board draws 44: a guess, Design 346). On a list row
 * (R55·217, which 334.3 does not withdraw), nine filled pills stacked
 * outweighed the page, so Follow is the 44 hairline pill and Following is
 * `--muted` text.
 */
const PILL_LOOK = {
  header: {
    follow: INK_PILL_INLINE,
    following: SECONDARY_PILL_INLINE,
  },
  row: {
    follow: LIST_PILL,
    following:
      "cursor-pointer border-none bg-transparent px-2 py-2 text-body text-muted",
  },
} as const;

function pillLook(where: "header" | "row", isFollowing: boolean): string {
  return PILL_LOOK[where][isFollowing ? "following" : "follow"];
}

/**
The band, under whatever the caller says failed.
*/
export function FollowBand({ toggle }: Readonly<{ toggle: FollowToggle }>) {
  return (
    <ControlFailureBand
      failure={toggle.control.failure}
      onRetry={toggle.control.retry}
      retryRef={toggle.control.retryRef}
    />
  );
}
