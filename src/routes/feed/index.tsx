import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { Feed } from "../../modules/feed/components/Feed";
import {
  followingFeedQuery,
  viewerUnitsQuery,
  yourConditionsQuery,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => {
    const [page, units] = await Promise.all([
      followingFeedQuery({ data: { cursor: undefined } }),
      viewerUnitsQuery(),
    ]);
    return { page, units };
  },
  component: FeedPage,
});

function FeedPage() {
  const { page, units } = Route.useLoaderData();

  return (
    <Layout>
      <Feed
        items={page.items}
        units={units}
        conditionsFor={yourConditionsQuery}
      />
    </Layout>
  );
}
