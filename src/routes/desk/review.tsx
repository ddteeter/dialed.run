import { createFileRoute, useRouter } from "@tanstack/react-router";

import { DeskPage, useDeskToday } from "../../modules/ops/components/DeskPage";
import { ReviewHeading } from "../../modules/ops/components/ReviewHeading";
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
  reportersAction,
  reviewHandleAction,
  reviewQueueQuery,
} from "../../modules/safety/functions";

/**
 * Desk · Review (decision D-87), the queue task 106 built, moved inside
 * the Desk by R-173: dark, with the rail. Behind `/desk`'s not-found for
 * anyone who is not an operator, and `reviewQueueQuery` and every action
 * check `requireAdmin` besides.
 */
export const Route = createFileRoute("/desk/review")({
  loader: async () => reviewQueueQuery(),
  component: ReviewPage,
});

function ReviewPage() {
  const today = useDeskToday();
  const router = useRouter();
  const { queue, requests, quarantine, holds, bursts, burstsSince } =
    Route.useLoaderData();

  return (
    <DeskPage current="review">
      <ReviewHeading counts={today.counts} />
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
        reporters={reportersAction}
        asOf={today.asOf}
        onDecided={() => {
          void router.invalidate();
        }}
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
    </DeskPage>
  );
}
