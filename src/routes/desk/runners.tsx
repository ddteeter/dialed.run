import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { DeskShell } from "../../modules/ops/components/DeskShell";
import { DeskRunners } from "../../modules/safety/components/DeskRunners";
import {
  banUserAction,
  deskRunnersQuery,
  forceRenameAction,
  unbanUserAction,
} from "../../modules/safety/functions";
import { runnersFilterInput } from "../../modules/safety/inputs";

const desk = getRouteApi("/desk");

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
  const today = desk.useLoaderData();
  const { runners, total } = Route.useLoaderData();
  const filter = Route.useSearch();

  return (
    <DeskShell current="runners" today={today}>
      <DeskRunners
        runners={runners}
        total={total}
        filter={filter}
        rename={forceRenameAction}
        ban={banUserAction}
        unban={unbanUserAction}
      />
    </DeskShell>
  );
}
