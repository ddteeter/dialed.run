import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { Feed } from "../../modules/feed/components/Feed";
import {
  followingFeedQuery,
  yourConditionsQuery,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => ({
    page: await followingFeedQuery({ data: { cursor: undefined } }),
  }),
  component: FeedPage,
});

function FeedPage() {
  return (
    <Layout>
      <Feed
        items={Route.useLoaderData().page.items}
        conditionsFor={yourConditionsQuery}
      />
    </Layout>
  );
}
