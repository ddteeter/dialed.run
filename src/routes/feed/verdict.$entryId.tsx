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
  setCountInTotalsFn,
  settingsQuery,
} from "../../modules/onboarding/functions";
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
    const entry = orBackToFeed(
      await entryDetailQuery({ data: { entryId: params.entryId } }),
    );
    const { countInTotals } = await settingsQuery();
    return {
      entry,
      units: await viewerUnitsQuery(),
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
  const { entry, bandFloor, history, units, isVerified, countInTotals } =
    Route.useLoaderData();

  return (
    <Layout>
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
