import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { AttachKit } from "../../modules/feed/components/AttachKit";
import {
  attachKitAction,
  pickerGroupsQuery,
  prefillQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

// fallow-ignore-next-line code-duplication -- two signed-in feed routes are the same route shape by mandate: createFileRoute + beforeLoad gate + a one-call loader + shell is what server-functions-are-glue requires of a route
export const Route = createFileRoute("/feed/attach/$runId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => ({ units: await viewerUnitsQuery() }),
  component: AttachKitPage,
});

function AttachKitPage() {
  return (
    <Layout>
      <AttachKit
        runId={Route.useParams().runId}
        units={Route.useLoaderData().units}
        prefillFor={prefillQuery}
        pickerGroupsFor={pickerGroupsQuery}
        attachKit={attachKitAction}
      />
    </Layout>
  );
}
