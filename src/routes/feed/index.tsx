import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { Feed } from "../../modules/feed/components/Feed";
import {
  conditionsHomeQuery,
  followingFeedQuery,
  saveConditionsCityAction,
  toggleUsefulAction,
  unjudgedRunCountQuery,
  viewerUnitsQuery,
  yourConditionsQuery,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { geolocate } from "../../modules/onboarding/geolocate";
import { nowSeconds } from "../../lib/now";

export const Route = createFileRoute("/feed/")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => {
    const [page, units, unjudgedCount, bell, home] = await Promise.all([
      followingFeedQuery({ data: { cursor: undefined } }),
      viewerUnitsQuery(),
      unjudgedRunCountQuery(),
      bellStateFn(),
      conditionsHomeQuery(),
    ]);
    // Read once here, so the server and the browser render the same
    // "2h ago" rather than two clocks disagreeing across an hour.
    return { page, units, unjudgedCount, bell, home, now: nowSeconds() };
  },
  component: FeedPage,
});

function FeedPage() {
  const { page, units, unjudgedCount, bell, home, now } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Feed
        items={page.items}
        followeeCount={page.followeeCount}
        now={now}
        units={units}
        unjudgedCount={unjudgedCount}
        toggleUseful={toggleUsefulAction}
        conditions={{
          home,
          locate: geolocate,
          conditionsFor: yourConditionsQuery,
          saveCity: saveConditionsCityAction,
        }}
      />
    </BelledLayout>
  );
}
