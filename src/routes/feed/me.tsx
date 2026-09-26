import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { OwnProfile } from "../../modules/feed/components/OwnProfile";
import { ownProfileQuery } from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/me")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => ({
    profile: await ownProfileQuery(),
    bell: await bellStateFn(),
  }),
  component: OwnProfilePage,
});

function OwnProfilePage() {
  const { profile, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <OwnProfile profile={profile} />
    </BelledLayout>
  );
}
