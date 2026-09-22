import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { ReviewQueue } from "../../modules/safety/components/ReviewQueue";
import {
  resolveReviewAction,
  reviewQueueQuery,
} from "../../modules/safety/functions";
import { Layout, Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two signed-in routes of one lane are the same shape by mandate: createFileRoute + requireSignedIn + one loader call + Layout + Page + a component is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/safety/review")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  // Admin-only, and the gate is `requireAdmin` inside the server function
  // rather than a check here: a route may not branch, and a privilege test
  // in a loader is one no test can reach.
  loader: async () => reviewQueueQuery(),
  component: ReviewPage,
});

function ReviewPage() {
  const { queue } = Route.useLoaderData();

  return (
    <Layout>
      <Page title="Review queue" width="column">
        <ReviewQueue queue={queue} resolve={resolveReviewAction} />
      </Page>
    </Layout>
  );
}
