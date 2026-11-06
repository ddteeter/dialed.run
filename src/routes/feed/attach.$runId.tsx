import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { AttachKit } from "../../modules/feed/components/AttachKit";
import { orOnToVerdict } from "../../modules/feed/attach-rules";
import {
  attachContextQuery,
  attachKitAction,
  bandRunsQuery,
  prefillForRunQuery,
  uploadPhotoAction,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";

// fallow-ignore-next-line code-duplication -- two signed-in feed routes are the same route shape by mandate: createFileRoute + beforeLoad gate + a one-call loader + shell is what server-functions-are-glue requires of a route
export const Route = createFileRoute("/feed/attach/$runId")({
  // D-102's name for the page: its heading is a question.
  staticData: { savedPage: "Attach the kit" },
  beforeLoad: async ({ location }) => {
    requireSignedIn(await getSession(), location);
  },
  loader: async ({ params }) => {
    const [found, units, bell] = await Promise.all([
      attachContextQuery({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    return { context: orOnToVerdict(orBackToFeed(found)), units, bell };
  },
  component: AttachKitPage,
});

function AttachKitPage() {
  const { context, units, bell } = Route.useLoaderData();
  // DS1b: the bell is on every screen (R-102).
  return (
    <BelledLayout {...bell}>
      <AttachKit
        runId={Route.useParams().runId}
        units={units}
        context={context}
        prefillFor={prefillForRunQuery}
        bandRunsFor={bandRunsQuery}
        attachKit={attachKitAction}
        uploadPhoto={uploadPhotoAction}
        renderPhotoStep={photoBlurStep}
      />
    </BelledLayout>
  );
}
