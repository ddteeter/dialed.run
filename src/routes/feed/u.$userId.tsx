import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { OtherProfile } from "../../modules/feed/components/OtherProfile";
import { ReportAffordance } from "../../modules/safety/components/ReportAffordance";
import { fileReportAction } from "../../modules/safety/functions";
import {
  followAction,
  followStatusQuery,
  otherProfileQuery,
  unfollowAction,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/u/$userId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => ({
    profile: orBackToFeed(
      await otherProfileQuery({ data: { userId: params.userId } }),
    ),
    isFollowing: await followStatusQuery({ data: { userId: params.userId } }),
    viewerId: requireSignedIn(await getSession()).user.id,
    bell: await bellStateFn(),
  }),
  component: OtherProfilePage,
});

function OtherProfilePage() {
  const { profile, isFollowing, viewerId, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <OtherProfile
        profile={profile}
        isFollowing={isFollowing}
        follow={followAction}
        unfollow={unfollowAction}
        reportAffordance={
          <ReportAffordance
            subject={{
              type: "profile",
              id: profile.userId,
              label: profile.displayName ?? "A runner",
              authorId: profile.userId,
              authorName: profile.displayName ?? undefined,
            }}
            viewerId={viewerId}
            fileReport={fileReportAction}
          />
        }
      />
    </BelledLayout>
  );
}
