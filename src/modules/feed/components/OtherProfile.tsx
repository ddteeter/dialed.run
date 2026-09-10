import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Mono } from "../../../ui";
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
}: Readonly<{
  profile: OtherProfileData;
  isFollowing: boolean;
  follow: (input: { data: { userId: string } }) => Promise<unknown>;
  unfollow: (input: { data: { userId: string } }) => Promise<unknown>;
}>) {
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const [pending, setPending] = useState(false);
  const { userId } = profile;

  async function toggleFollow() {
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl uppercase leading-none">
            {profile.displayName ?? "A runner"}
          </h1>
          {profile.cityLabel === null ? undefined : (
            <p className="m-0 text-sm text-night/60">{profile.cityLabel}</p>
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void toggleFollow();
          }}
          className={
            isFollowing
              ? "rounded-md border border-night/20 px-4 py-2 font-semibold disabled:opacity-40"
              : "rounded-md bg-night px-4 py-2 font-semibold text-chalk disabled:opacity-40"
          }
        >
          {isFollowing ? "Following" : "Follow"}
        </button>
      </div>

      {profile.recentPublicEntries.length === 0 ? (
        <p className="text-sm text-night/60">No public entries yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {profile.recentPublicEntries.map((entry) => (
            <li
              key={entry.entryId}
              className="rounded-xl border border-night/10 p-4"
            >
              <Link
                to="/feed/entry/$entryId"
                params={{ entryId: entry.entryId }}
                className="flex flex-col gap-1 text-night no-underline"
              >
                {entry.caption === null ? undefined : (
                  <p className="m-0 text-sm">{entry.caption}</p>
                )}
                <Mono className="text-xs text-night/40">
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
