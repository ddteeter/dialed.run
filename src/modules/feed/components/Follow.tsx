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
  });
  const { status } = control;
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  return { isFollowing, control };
}

/**
 * The pill. Follow is the primary, in the action pink; Following drops to
 * a hairline, because following again is not the thing to do next.
 */
export function FollowPill({ toggle }: Readonly<{ toggle: FollowToggle }>) {
  const { isFollowing, control } = toggle;
  return (
    <button
      type="button"
      {...inFlight(control.pending)}
      onClick={() => {
        void control.run();
      }}
      className={`target shrink-0 cursor-pointer rounded-pill px-5 py-2 text-body font-bold text-ink ${
        isFollowing
          ? "border border-hairline bg-transparent"
          : "border-none bg-action"
      }`}
    >
      <PendingLabel
        label={isFollowing ? "Following" : "Follow"}
        pendingLabel={isFollowing ? "Unfollowing" : "Following"}
        pending={control.pending}
      />
    </button>
  );
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
