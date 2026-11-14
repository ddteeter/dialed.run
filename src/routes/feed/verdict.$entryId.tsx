import { createFileRoute } from "@tanstack/react-router";

import { bandFloorC } from "../../lib/contracts/temperature";
import { getSession } from "../../modules/auth/functions";
import { VerdictForm } from "../../modules/feed/components/VerdictForm";
import { verdictSearch } from "../../modules/feed/kit-push";
import { bandContextFor } from "../../modules/feed/route-decisions";
import {
  bandRunsQuery,
  bandSignalsQuery,
  entryDetailQuery,
  itemBandWearStatQuery,
  submitVerdictAction,
  verdictBandCountsQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { PrivateRunLine } from "../../modules/onboarding/components/PrivateRunLine";
import {
  countInTotalsQuery,
  setCountInTotalsFn,
} from "../../modules/onboarding/functions";
import { RunRemovals } from "../../modules/safety/components/RunRemovals";
import { runRemovalsQuery } from "../../modules/safety/functions";

export const Route = createFileRoute("/feed/verdict/$entryId")({
  // D-102's name for the page: its heading is a question.
  staticData: { savedPage: "The verdict" },
  // A3b's push at the desk is `?specifics=true` on this page (Round 54 ·
  // 164.3).
  validateSearch: verdictSearch,
  // A push changes only the search: the entry and its band are the ones
  // already loaded, and A3's unsaved answer is still on the page.
  // Typed by hand, as A2's route types it.
  shouldReload: ({ cause }: { cause: string }) => cause !== "stay",
  // The session it already reads also says whether the address is
  // confirmed, which picks A3's private line (D-108 E, round 27 first).
  beforeLoad: async ({ location }) => ({
    isVerified: requireSignedIn(await getSession(), location).user
      .emailVerified,
  }),
  loader: async ({ params, context }) => {
    const [found, units, { countInTotals }, bell] = await Promise.all([
      entryDetailQuery({ data: { entryId: params.entryId } }),
      viewerUnitsQuery(),
      countInTotalsQuery(),
      bellStateFn(),
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
      bell,
      ...(await bandContextFor(entry, bandFloorC, async (bandFloor) => {
        const [counts, signals, runs] = await Promise.all([
          verdictBandCountsQuery({
            data: { bandFloorC: bandFloor, excludeEntryId: params.entryId },
          }),
          bandSignalsQuery({
            data: { bandFloorC: bandFloor, entryId: params.entryId },
          }),
          bandRunsQuery({
            data: { bandFloorC: bandFloor, excludeEntryId: params.entryId },
          }),
        ]);
        return { counts, signals, runs };
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
    bell,
  } = Route.useLoaderData();
  const { specifics } = Route.useSearch();
  const navigate = Route.useNavigate();

  // DS1b: the bell is on every screen (R-102).
  return (
    <BelledLayout {...bell}>
      <RunRemovals removals={removals} />
      <VerdictForm
        entry={entry}
        bandFloor={bandFloor}
        history={history}
        units={units}
        submitVerdict={submitVerdictAction}
        itemBandWearStat={itemBandWearStatQuery}
        isVerified={isVerified}
        push={{
          isPushed: specifics === true,
          onPush: () => {
            void navigate({ search: { specifics: true } });
          },
          onDone: () => {
            void navigate({ search: {} });
          },
        }}
        privateLine={(hintId) => (
          <PrivateRunLine
            hintId={hintId}
            isVerified={isVerified}
            countInTotals={countInTotals}
            saveCountInTotals={setCountInTotalsFn}
          />
        )}
      />
    </BelledLayout>
  );
}
