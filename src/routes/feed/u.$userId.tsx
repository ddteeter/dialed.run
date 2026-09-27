import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { otherProfileQuery } from "../../modules/feed/functions";
import { requireSignedIn, toHandlePage } from "../../modules/feed/redirect";
import { noindexHead } from "../../modules/feed/route-decisions";

/**
 * H by id, kept as an address because links and specs already use it, and
 * sent to `/@handle` — the one H (round 26 #7, FEED-10). A redirect from
 * an id names nobody new: it leads to the handle the runner holds now,
 * never from an old handle (decision D-56).
 */
export const Route = createFileRoute("/feed/u/$userId")({
  head: noindexHead,
  beforeLoad: async ({ params }) => {
    requireSignedIn(await getSession());
    toHandlePage(await otherProfileQuery({ data: { userId: params.userId } }));
  },
});
