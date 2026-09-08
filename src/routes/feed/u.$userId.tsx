import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { getSession } from "../../modules/auth/functions";
import {
  followAction,
  followStatusQuery,
  otherProfileQuery,
  unfollowAction,
} from "../../modules/feed/functions";
import { redirectTo } from "../../modules/feed/redirect";
import { Layout, Mono } from "../../ui";

export const Route = createFileRoute("/feed/u/$userId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  loader: async ({ params }) => {
    const profile = await otherProfileQuery({ data: { userId: params.userId } });
    if (!profile) redirectTo({ to: "/feed" });
    const isFollowing = await followStatusQuery({ data: { userId: params.userId } });
    return { profile, isFollowing };
  },
  component: OtherProfilePage,
});

function OtherProfilePage() {
  const { userId } = Route.useParams();
  const { profile, isFollowing: initiallyFollowing } = Route.useLoaderData();
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const [pending, setPending] = useState(false);

  async function toggleFollow() {
    setPending(true);
    try {
      if (isFollowing) {
        await unfollowAction({ data: { userId } });
        setIsFollowing(false);
      } else {
        await followAction({ data: { userId } });
        setIsFollowing(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl uppercase leading-none">
              {profile.displayName ?? "A runner"}
            </h1>
            {profile.cityLabel ? (
              <p className="m-0 text-sm text-night/60">{profile.cityLabel}</p>
            ) : undefined}
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

        {profile.recentPublicEntries.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {profile.recentPublicEntries.map((entry) => (
              <li key={entry.entryId} className="rounded-xl border border-night/10 p-4">
                <Link
                  to="/feed/entry/$entryId"
                  params={{ entryId: entry.entryId }}
                  className="flex flex-col gap-1 text-night no-underline"
                >
                  {entry.caption ? <p className="m-0 text-sm">{entry.caption}</p> : undefined}
                  <Mono className="text-xs text-night/40">
                    {new Date(entry.createdAt * 1000).toLocaleDateString()}
                  </Mono>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-night/60">No public entries yet.</p>
        )}
      </div>
    </Layout>
  );
}
