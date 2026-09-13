import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { CallLadder } from "../../modules/onboarding/components/CallLadder";
import { callLadderQuery } from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
Screen O6, as the Call tab's teaser (D-16). Progress only — the call
itself is the next epic, and nothing here reads a garment.
*/
// fallow-ignore-next-line code-duplication -- two signed-in routes with a two-call loader are the same route shape by mandate: createFileRoute + Promise.all + shell is what server-functions-are-glue requires of a route
export const Route = createFileRoute("/call/")({
  loader: async () => {
    const [ladder, unreadCount] = await Promise.all([
      callLadderQuery(),
      unreadNotificationCountFn(),
    ]);
    return { ladder, unreadCount };
  },
  component: CallPage,
});

function CallPage() {
  const { ladder, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="The Call">
        <CallLadder ladder={ladder} />
      </Page>
    </BelledLayout>
  );
}
