import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { AttachKit } from "../../modules/feed/components/AttachKit";
import { orOnToVerdict } from "../../modules/feed/attach-rules";
import { attachSearch } from "../../modules/feed/kit-push";
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
import { getRunSummaryFn } from "../../modules/runs/functions";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";

// fallow-ignore-next-line code-duplication -- two signed-in feed routes are the same route shape by mandate: createFileRoute + beforeLoad gate + a one-call loader + shell is what server-functions-are-glue requires of a route
export const Route = createFileRoute("/feed/attach/$runId")({
  // D-102's name for the page: its heading is a question.
  staticData: { savedPage: "Attach the kit" },
  // A2b's push at the desk is `?pick=` on this page (Round 54 · 164.3).
  validateSearch: attachSearch,
  // A push changes only the search: the run and the closet are the ones
  // already loaded, so it does not read them again.
  // Typed by hand: inferred from the route, it made the route's own
  // types circular.
  shouldReload: ({ cause }: { cause: string }) => cause !== "stay",
  beforeLoad: async ({ location }) => {
    requireSignedIn(await getSession(), location);
  },
  loader: async ({ params }) => {
    const [found, summary, units, bell] = await Promise.all([
      attachContextQuery({ data: { runId: params.runId } }),
      getRunSummaryFn({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    return {
      context: orOnToVerdict(orBackToFeed(found)),
      run: orBackToFeed(summary),
      units,
      bell,
    };
  },
  component: AttachKitPage,
});

function AttachKitPage() {
  const { context, run, units, bell } = Route.useLoaderData();
  const { pick } = Route.useSearch();
  const navigate = Route.useNavigate();
  // DS1b: the bell is on every screen (R-102).
  return (
    <BelledLayout {...bell}>
      <AttachKit
        runId={Route.useParams().runId}
        units={units}
        context={context}
        run={run}
        pushed={pick}
        onPush={(group) => {
          void navigate({ search: { pick: group } });
        }}
        onPushDone={() => {
          void navigate({ search: {} });
        }}
        prefillFor={prefillForRunQuery}
        bandRunsFor={bandRunsQuery}
        attachKit={attachKitAction}
        uploadPhoto={uploadPhotoAction}
        renderPhotoStep={photoBlurStep}
      />
    </BelledLayout>
  );
}
