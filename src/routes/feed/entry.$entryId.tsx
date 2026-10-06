import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { EntryDetail } from "../../modules/feed/components/EntryDetail";
import { RetractEntry } from "../../modules/feed/components/RetractEntry";
import { ReportAffordance } from "../../modules/safety/components/ReportAffordance";
import { fileReportAction } from "../../modules/safety/functions";
import {
  noindexHead,
  shouldAskForVerdict,
} from "../../modules/feed/route-decisions";
import {
  deleteEntryPhotoAction,
  entryDetailQuery,
  recordVerdictPromptedAction,
  retractEntryAction,
  setUsefulAction,
  verdictPromptQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/entry/$entryId")({
  head: noindexHead,
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => {
    const [session, found, units, bell] = await Promise.all([
      getSession(),
      entryDetailQuery({ data: { entryId: params.entryId } }),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    const viewerId = requireSignedIn(session).user.id;
    const entry = orBackToFeed(found);
    return {
      entry,
      viewerId,
      units,
      bell,
      shouldPromptVerdict: await shouldAskForVerdict(entry, viewerId, () =>
        verdictPromptQuery({ data: { entryId: params.entryId } }),
      ),
    };
  },
  component: EntryDetailPage,
});

function EntryDetailPage() {
  const { entryId } = Route.useParams();
  const { entry, shouldPromptVerdict, units, viewerId, bell } =
    Route.useLoaderData();
  const navigate = useNavigate();

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
              authorName: entry.authorUsername,
            }}
            viewerId={viewerId}
            fileReport={fileReportAction}
          />
        }
      />
      <RetractEntry
        entry={entry}
        viewerId={viewerId}
        retract={retractEntryAction}
        deletePhoto={deleteEntryPhotoAction}
        onRetracted={async () => {
          await navigate({ to: "/feed" });
        }}
      />
    </BelledLayout>
  );
}
