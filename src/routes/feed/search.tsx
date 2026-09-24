import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { RunnerSearch } from "../../modules/feed/components/RunnerSearch";
import {
  followAction,
  searchQuery,
  unfollowAction,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/search")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => ({ bell: await bellStateFn() }),
  component: SearchPage,
});

function SearchPage() {
  const { bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <RunnerSearch
        search={searchQuery}
        follow={followAction}
        unfollow={unfollowAction}
      />
    </BelledLayout>
  );
}
