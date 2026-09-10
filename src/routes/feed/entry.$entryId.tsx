import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { EntryDetail } from "../../modules/feed/components/EntryDetail";
import { shouldAskForVerdict } from "../../modules/feed/entries";
import {
  entryDetailQuery,
  recordVerdictPromptedAction,
  toggleUsefulAction,
  verdictPromptQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

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
      shouldPromptVerdict: await shouldAskForVerdict(entry, session.user.id, () =>
        verdictPromptQuery({ data: { entryId: params.entryId } }),
      ),
    };
  },
  component: EntryDetailPage,
});

function EntryDetailPage() {
  const { entryId } = Route.useParams();
  const { entry, shouldPromptVerdict } = Route.useLoaderData();

  return (
    <Layout>
      <EntryDetail
        entry={entry}
        entryId={entryId}
        shouldPromptVerdict={shouldPromptVerdict}
        recordPrompted={recordVerdictPromptedAction}
        toggleUseful={toggleUsefulAction}
      />
    </Layout>
  );
}
