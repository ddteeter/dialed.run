import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { EntryDetail } from "../../modules/feed/components/EntryDetail";
import { ReportAffordance } from "../../modules/safety/components/ReportAffordance";
import { fileReportAction } from "../../modules/safety/functions";
import { shouldAskForVerdict } from "../../modules/feed/route-decisions";
import {
  entryDetailQuery,
  recordVerdictPromptedAction,
  setUsefulAction,
  verdictPromptQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/entry/$entryId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => {
    const session = requireSignedIn(await getSession());
    const entry = orBackToFeed(
      await entryDetailQuery({ data: { entryId: params.entryId } }),
    );
    return {
      entry,
      viewerId: session.user.id,
      units: await viewerUnitsQuery(),
      bell: await bellStateFn(),
      shouldPromptVerdict: await shouldAskForVerdict(
        entry,
        session.user.id,
        () => verdictPromptQuery({ data: { entryId: params.entryId } }),
      ),
    };
  },
  component: EntryDetailPage,
});

function EntryDetailPage() {
  const { entryId } = Route.useParams();
  const { entry, shouldPromptVerdict, units, viewerId, bell } =
    Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <EntryDetail
        entry={entry}
        viewerId={viewerId}
        units={units}
        shouldPromptVerdict={shouldPromptVerdict}
        recordPrompted={recordVerdictPromptedAction}
        setUseful={setUsefulAction}
        reportAffordance={
          <ReportAffordance
            subject={{
              type: "entry",
              id: entryId,
              label: entry.runTitle,
              authorId: entry.userId,
              authorName: entry.authorDisplayName,
            }}
            viewerId={viewerId}
            fileReport={fileReportAction}
          />
        }
      />
    </BelledLayout>
  );
}
