import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { DeskShell } from "../../modules/ops/components/DeskShell";
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

// fallow-ignore-next-line code-duplication -- two Desk pages are the same shape by mandate: getRouteApi("/desk") + createFileRoute + one loader call + DeskShell + a component is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
const desk = getRouteApi("/desk");

/**
 * Desk · Review (decision D-87), the queue task 106 built, moved inside
 * the Desk by R-173: dark, with the rail. Behind `/desk`'s not-found for
 * anyone who is not an operator, and `reviewQueueQuery` and every action
 * check `requireAdmin` besides. `/safety/review` redirects here.
 */
export const Route = createFileRoute("/desk/review")({
  loader: async () => reviewQueueQuery(),
  component: ReviewPage,
});

function ReviewPage() {
  const today = desk.useLoaderData();
  const { queue, requests, quarantine, holds, bursts, burstsSince } =
    Route.useLoaderData();

  return (
    <DeskShell current="review" today={today}>
      {/* The heading Review had on its own page, at the Desk's size. */}
      <h1 className="m-0 font-display text-title uppercase">Review queue</h1>
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
    </DeskShell>
  );
}
