import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { DeskTodayPage } from "../../modules/ops/components/Today";
import {
  deskGaveUpQuery,
  dropGaveUpAction,
  retryGaveUpAction,
} from "../../modules/ops/functions";

const desk = getRouteApi("/desk");

/**
 * Today (Operator Screens D0): the digest, rendered, from the `/desk`
 * layout's loader — the same `todayCounts` the daily digest reads — and
 * Gave up under it, from this page's own (D6; R-119).
 */
export const Route = createFileRoute("/desk/")({
  loader: async () => deskGaveUpQuery(),
  component: TodayPage,
});

function TodayPage() {
  return (
    <DeskTodayPage
      today={desk.useLoaderData()}
      gaveUp={Route.useLoaderData()}
      retry={retryGaveUpAction}
      drop={dropGaveUpAction}
    />
  );
}
