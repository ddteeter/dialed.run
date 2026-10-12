import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { CallLadder } from "../../modules/onboarding/components/CallLadder";
import { callLadderQuery } from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
Screen O6, as the Call tab's teaser (D-16). Progress only — the call
itself is the next epic, and nothing here reads a garment.
*/
export const Route = createFileRoute("/call/")({
  loader: async ({ location }) => {
    await requireSession(location);
    // fallow-ignore-next-line code-duplication -- two signed-in routes with a two-call loader are the same route shape by mandate: createFileRoute + Promise.all + shell is what server-functions-are-glue requires of a route
    const [ladder, bell] = await Promise.all([
      callLadderQuery(),
      bellStateFn(),
    ]);
    return { ladder, bell };
  },
  component: CallPage,
});

function CallPage() {
  const { ladder, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Page width="panel">
        <CallLadder ladder={ladder} />
      </Page>
    </BelledLayout>
  );
}
