import { createFileRoute } from "@tanstack/react-router";

import { bandFloorC } from "../../lib/contracts/temperature";
import { getSession } from "../../modules/auth/functions";
import { VerdictForm } from "../../modules/feed/components/VerdictForm";
import { bandContextFor } from "../../modules/feed/route-decisions";
import {
  bandSignalsQuery,
  entryDetailQuery,
  itemBandWearStatQuery,
  submitVerdictAction,
  verdictBandCountsQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { PrivateRunLine } from "../../modules/onboarding/components/PrivateRunLine";
import {
  countInTotalsQuery,
  setCountInTotalsFn,
} from "../../modules/onboarding/functions";
import { RunRemovals } from "../../modules/safety/components/RunRemovals";
import { runRemovalsQuery } from "../../modules/safety/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/verdict/$entryId")({
  // D-102's name for the page: its heading is a question.
  staticData: { savedPage: "The verdict" },
  // The session it already reads also says whether the address is
  // confirmed, which picks A3's private line (D-108 E, round 27 first).
  beforeLoad: async ({ location }) => ({
    isVerified: requireSignedIn(await getSession(), location).user
      .emailVerified,
  }),
  loader: async ({ params, context }) => {
    const [found, units, { countInTotals }] = await Promise.all([
      entryDetailQuery({ data: { entryId: params.entryId } }),
      viewerUnitsQuery(),
      countInTotalsQuery(),
    ]);
    const entry = orBackToFeed(found);
    // R-140: the band where it was, as on the entry page — a runner is sent
    // here straight after logging, which is when a removal is likeliest to
    // have just landed.
    const removals = await runRemovalsQuery({
      data: { runId: entry.runId, since: entry.createdAt },
    });
    return {
      entry,
      removals,
      units,
      isVerified: context.isVerified,
      countInTotals,
      ...(await bandContextFor(entry, bandFloorC, async (bandFloor) => {
        const [counts, signals] = await Promise.all([
          verdictBandCountsQuery({
            data: { bandFloorC: bandFloor, excludeEntryId: params.entryId },
          }),
          bandSignalsQuery({
            data: { bandFloorC: bandFloor, entryId: params.entryId },
          }),
        ]);
        return { counts, signals };
      })),
    };
  },
  component: VerdictPage,
});

function VerdictPage() {
  const {
    entry,
    bandFloor,
    history,
    units,
    isVerified,
    countInTotals,
    removals,
  } = Route.useLoaderData();

  return (
    <Layout>
      <RunRemovals removals={removals} />
      <VerdictForm
        entry={entry}
        bandFloor={bandFloor}
        history={history}
        units={units}
        submitVerdict={submitVerdictAction}
        itemBandWearStat={itemBandWearStatQuery}
        privateLine={(hintId) => (
          <PrivateRunLine
            hintId={hintId}
            isVerified={isVerified}
            countInTotals={countInTotals}
            saveCountInTotals={setCountInTotalsFn}
          />
        )}
      />
    </Layout>
  );
}
