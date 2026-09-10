import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { OwnProfile } from "../../modules/feed/components/OwnProfile";
import { ownProfileQuery } from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/me")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => ({ profile: await ownProfileQuery() }),
  component: OwnProfilePage,
});

function OwnProfilePage() {
  return (
    <Layout>
      <OwnProfile profile={Route.useLoaderData().profile} />
    </Layout>
  );
}
