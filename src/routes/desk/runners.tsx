import { createFileRoute } from "@tanstack/react-router";

import { DeskPage } from "../../modules/ops/components/DeskPage";
import { DeskRunners } from "../../modules/safety/components/DeskRunners";
import {
  banUserAction,
  deskRunnersQuery,
  forceRenameAction,
  keepAccountAction,
  unbanUserAction,
} from "../../modules/safety/functions";
import { runnersFilterInput } from "../../modules/safety/inputs";

/**
 * Desk · Runners, "D8" (round 27 #22): every account, a search, and the
 * selected runner's Rename and Close account. Behind `/desk`'s not-found
 * gate like every page under it; the server functions check again.
 */
export const Route = createFileRoute("/desk/runners")({
  validateSearch: runnersFilterInput,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => deskRunnersQuery({ data: deps }),
  component: RunnersPage,
});

function RunnersPage() {
  const { runners, total, flagged } = Route.useLoaderData();
  const filter = Route.useSearch();

  return (
    <DeskPage current="runners">
      <DeskRunners
        runners={runners}
        total={total}
        flagged={flagged}
        filter={filter}
        rename={forceRenameAction}
        ban={banUserAction}
        unban={unbanUserAction}
        keep={keepAccountAction}
      />
    </DeskPage>
  );
}
