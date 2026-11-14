import { useEffect, useState } from "react";

import {
  ControlFailureBand,
  inFlight,
  PendingLabel,
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
 * The pill. On H's header Follow is the primary, in the action pink, and
 * Following drops to a hairline, because following again is not the thing
 * to do next; on a list row both are quieter (`PILL_LOOK`).
 *
 * **On a list row its name carries the handle** (round 52 #157): heard
 * alone, a row's pill said "Follow" and not whose. `handle` is that
 * runner's, as drawn beside it, visually hidden and in every state. H's
 * header passes none: its h1 names the runner.
 */
export function FollowPill({
  toggle,
  handle,
}: Readonly<{ toggle: FollowToggle; handle?: string | undefined }>) {
  const { isFollowing, control } = toggle;
  return (
    <button
      type="button"
      {...inFlight(control.pending)}
      onClick={() => {
        void control.run();
      }}
      className={pillLook(handle === undefined ? "header" : "row", isFollowing)}
    >
      <PendingLabel
        label={isFollowing ? "Following" : "Follow"}
        pendingLabel={isFollowing ? "Unfollowing" : "Following"}
        pending={control.pending}
      />
      {handle === undefined ? undefined : (
        <span className="sr-only">{` ${handle}`}</span>
      )}
    </button>
  );
}

/**
 * The pill's look. On H's header, Follow is the primary in the action
 * pink and Following a hairline. On a list row (R55·217), nine pink pills
 * stacked outweighed the page, so Follow is the 44 hairline pill and
 * Following is `--muted` text: the only pink left is Log a run.
 */
const PILL_LOOK = {
  header: {
    follow:
      "target shrink-0 cursor-pointer rounded-pill border-none bg-action px-5 py-2 text-body font-bold text-accent-ink",
    following:
      "target shrink-0 cursor-pointer rounded-pill border border-ink bg-transparent px-5 py-2 text-body font-bold text-ink",
  },
  row: {
    follow:
      "target shrink-0 cursor-pointer rounded-pill border border-hairline bg-transparent px-5 py-2 text-body font-bold text-ink",
    following:
      "target shrink-0 cursor-pointer border-none bg-transparent px-2 py-2 text-body text-muted",
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
