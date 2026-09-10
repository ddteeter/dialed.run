import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { OtherProfile } from "../../modules/feed/components/OtherProfile";
import {
  followAction,
  followStatusQuery,
  otherProfileQuery,
  unfollowAction,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/u/$userId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => ({
    profile: orBackToFeed(
      await otherProfileQuery({ data: { userId: params.userId } }),
    ),
    isFollowing: await followStatusQuery({ data: { userId: params.userId } }),
  }),
  component: OtherProfilePage,
});

function OtherProfilePage() {
  const { profile, isFollowing } = Route.useLoaderData();

  return (
    <Layout>
      <OtherProfile
        profile={profile}
        isFollowing={isFollowing}
        follow={followAction}
        unfollow={unfollowAction}
      />
    </Layout>
  );
}
