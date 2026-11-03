import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { CopyrightHolds } from "../../modules/safety/components/CopyrightHolds";
import { QuarantineRecords } from "../../modules/safety/components/QuarantineRecords";
import { ReleaseHolds } from "../../modules/safety/components/ReleaseHolds";
import { RemovalRequests } from "../../modules/safety/components/RemovalRequests";
import { ReviewQueue } from "../../modules/safety/components/ReviewQueue";
import { Takedown } from "../../modules/safety/components/Takedown";
import {
  caseOverDeleteAction,
  decideGarmentMatchAction,
  decideRemovalRequestAction,
  decideReviewAction,
  takedownAction,
} from "../../modules/feed/functions";
import {
  blockTakedownRequesterAction,
  caseOverRestoreAction,
  counterNoticeAction,
  courtActionAction,
  recordNcmecReportAction,
  releaseHoldsAction,
  reviewHandleAction,
  reviewQueueQuery,
} from "../../modules/safety/functions";
import { Layout, Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two signed-in routes of one lane are the same shape by mandate: createFileRoute + requireSignedIn + one loader call + Layout + Page + a component is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/safety/review")({
  beforeLoad: async ({ location }) => {
    requireSignedIn(await getSession(), location);
  },
  // Admin-only, and the gate is `requireAdmin` inside the server function
  // rather than a check here: a route may not branch, and a privilege test
  // in a loader is one no test can reach.
  loader: async () => reviewQueueQuery(),
  component: ReviewPage,
});

function ReviewPage() {
  const { queue, requests, quarantine, holds, bursts, burstsSince } =
    Route.useLoaderData();

  return (
    <Layout>
      <Page title="Review queue" width="column">
        {/* Design 164: a burst of holds a bug may have made, to release. */}
        <ReleaseHolds
          bursts={bursts}
          since={burstsSince}
          release={releaseHoldsAction}
        />
        {/* Design 136: `/takedown` requests, soonest due first. */}
        <RemovalRequests
          requests={requests}
          decide={decideRemovalRequestAction}
          block={blockTakedownRequesterAction}
          decideMatch={decideGarmentMatchAction}
        />
        <ReviewQueue
          queue={queue}
          resolve={decideReviewAction}
          reviewHandle={reviewHandleAction}
          decideMatch={decideGarmentMatchAction}
        />
        {/* SAF-6: a removal the queue did not raise — a copyright notice
            naming a photo or an entry. */}
        <Takedown takeDown={takedownAction} />
        {/* D-130: what a copyright takedown holds for its 30 days. */}
        <CopyrightHolds
          holds={holds}
          counterNotice={counterNoticeAction}
          courtAction={courtActionAction}
          caseOverDelete={caseOverDeleteAction}
          caseOverRestore={caseOverRestoreAction}
        />
        {/* C12: what is held for NCMEC, and recording its report. */}
        <QuarantineRecords
          records={quarantine}
          recordReport={recordNcmecReportAction}
        />
      </Page>
    </Layout>
  );
}
