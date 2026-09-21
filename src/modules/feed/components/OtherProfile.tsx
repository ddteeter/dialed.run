import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { inFlight, Mono, PendingLabel } from "../../../ui";
import type { OtherProfile as OtherProfileData } from "../profiles";

/**
 * Someone else's profile (screen H).
 *
 * v1 is public info plus recent *public* entries only — no aggregates.
 * The follow button is optimistic: it flips locally and the server
 * confirms, because a round trip between a tap and a label change reads as
 * a broken button.
 */
export function OtherProfile({
  profile,
  isFollowing: initiallyFollowing,
  follow,
  unfollow,
  reportAffordance,
}: Readonly<{
  profile: OtherProfileData;
  isFollowing: boolean;
  follow: (input: { data: { userId: string } }) => Promise<unknown>;
  unfollow: (input: { data: { userId: string } }) => Promise<unknown>;
  /**
   * W1's report control, composed by the route — a node rather than a
   * callback for the same boundary reason as `EntryDetail`: this module
   * may not reach `modules/safety`.
   */
  reportAffordance?: ReactNode;
}>) {
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const [pending, setPending] = useState(false);
  const { userId } = profile;

  async function toggleFollow() {
    // The guard the `disabled` attribute used to be. `aria-disabled` keeps
    // the button focusable and announcing, so nothing stops a second press
    // arriving — and a second press mid-flight would fire the opposite
    // endpoint against a state the server has not confirmed yet.
    if (pending) return;
    setPending(true);
    try {
      // The call and the flip are paired per direction: following and
      // unfollowing are different endpoints, and getting the pair crossed
      // would leave the label telling the opposite of the truth.
      if (isFollowing) {
        await unfollow({ data: { userId } });
        setIsFollowing(false);
      } else {
        await follow({ data: { userId } });
        setIsFollowing(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-title uppercase">
            {profile.displayName ?? "A runner"}
          </h1>
          {profile.cityLabel === null ? undefined : (
            <p className="m-0 text-small text-quiet">{profile.cityLabel}</p>
          )}
        </div>
        <button
          type="button"
          {...inFlight(pending)}
          onClick={() => {
            void toggleFollow();
          }}
          className={
            isFollowing
              ? "target rounded-pill border border-hairline px-4 py-2 font-semibold"
              : "target rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
          }
        >
          {/* Two rest labels and two pending verbs, because they are two
              actions: design's table spells it
              "Follow · Following" / "[ Following ] · [ Unfollowing ]". */}
          <PendingLabel
            label={isFollowing ? "Following" : "Follow"}
            pendingLabel={isFollowing ? "Unfollowing" : "Following"}
            pending={pending}
          />
        </button>
      </div>

      {reportAffordance}

      {profile.recentPublicEntries.length === 0 ? (
        <p className="text-small text-quiet">No public entries yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {profile.recentPublicEntries.map((entry) => (
            <li
              key={entry.entryId}
              className="rounded-card border border-hairline p-4"
            >
              <Link
                to="/feed/entry/$entryId"
                params={{ entryId: entry.entryId }}
                className="target flex flex-col gap-1 text-ink no-underline"
              >
                {entry.caption === null ? undefined : (
                  <p className="m-0 text-small">{entry.caption}</p>
                )}
                <Mono className="text-muted">
                  {new Date(entry.createdAt * 1000).toLocaleDateString()}
                </Mono>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
