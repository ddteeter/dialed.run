import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { AttachKit } from "../../modules/feed/components/AttachKit";
import { orOnToVerdict } from "../../modules/feed/attach-rules";
import {
  attachContextQuery,
  attachKitAction,
  prefillForRunQuery,
  uploadPhotoAction,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { Layout } from "../../ui";

// fallow-ignore-next-line code-duplication -- two signed-in feed routes are the same route shape by mandate: createFileRoute + beforeLoad gate + a one-call loader + shell is what server-functions-are-glue requires of a route
export const Route = createFileRoute("/feed/attach/$runId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => ({
    context: orOnToVerdict(
      orBackToFeed(await attachContextQuery({ data: { runId: params.runId } })),
    ),
    units: await viewerUnitsQuery(),
  }),
  component: AttachKitPage,
});

function AttachKitPage() {
  const { context, units } = Route.useLoaderData();
  return (
    <Layout>
      <AttachKit
        runId={Route.useParams().runId}
        units={units}
        context={context}
        prefillFor={prefillForRunQuery}
        attachKit={attachKitAction}
        uploadPhoto={uploadPhotoAction}
        renderPhotoStep={photoBlurStep}
      />
    </Layout>
  );
}
