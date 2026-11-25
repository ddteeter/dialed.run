import { createFileRoute, useRouter } from "@tanstack/react-router";

import {
  DeskPage,
  useDeskToday,
} from "../../modules/ops/desk/components/DeskPage";
import { ReviewHeading } from "../../modules/ops/desk/components/ReviewHeading";
import { CopyrightHolds } from "../../modules/safety/takedowns/components/CopyrightHolds";
import { QuarantineRecords } from "../../modules/safety/takedowns/components/QuarantineRecords";
import { ReleaseHolds } from "../../modules/safety/review/components/ReleaseHolds";
import { RemovalRequests } from "../../modules/safety/takedowns/components/RemovalRequests";
import { TakedownBlocks } from "../../modules/safety/takedowns/components/TakedownBlocks";
import { ReviewQueue } from "../../modules/safety/review/components/ReviewQueue";
import { Takedown } from "../../modules/safety/takedowns/components/Takedown";
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
  unblockTakedownRequesterAction,
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
  const {
    queue,
    requests,
    blocks,
    requestsPending,
    quarantine,
    holds,
    bursts,
    burstsSince,
  } = Route.useLoaderData();

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
        pending={requestsPending}
        asOf={today.asOf}
        decide={decideRemovalRequestAction}
        block={blockTakedownRequesterAction}
        decideMatch={decideGarmentMatchAction}
        onChanged={() => {
          void router.invalidate();
        }}
      />
      {/* Design 137: what Block and decline all blocked, and Unblock. */}
      <TakedownBlocks
        blocks={blocks}
        unblock={unblockTakedownRequesterAction}
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
