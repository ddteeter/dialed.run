import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { addFromTapListFn } from "../../modules/closet/functions";
import { TapListForm } from "../../modules/onboarding/components/TapListForm";
import { starterListQuery } from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
 * Screen O3. The list arrives already ordered for this runner's climate
 * band — see `starter-list.ts` for why the sort happens server-side.
 */
// fallow-ignore-next-line code-duplication -- two steps of one flow are the same route by mandate: createFileRoute + requireSession + one loader call + Page + a component, which is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/onboarding/taplist")({
  loader: async () => {
    await requireSession();
    return { starter: await starterListQuery() };
  },
  component: TapListPage,
});

function TapListPage() {
  const { starter } = Route.useLoaderData();
  const navigate = useNavigate();
  // Both Next and Skip land on P2.5, which is itself skippable — the flow
  // is a chain of offers, not a funnel with a gate in it.
  const done = () => {
    void navigate({ to: "/onboarding/name" });
  };

  return (
    <Page title="Start your closet" width="narrow">
      <TapListForm
        entries={starter.entries}
        fold={starter.fold}
        saveTapList={addFromTapListFn}
        onSaved={done}
        onSkip={done}
      />
    </Page>
  );
}
