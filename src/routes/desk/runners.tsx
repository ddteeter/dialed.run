import { createFileRoute } from "@tanstack/react-router";

import { DeskPage } from "../../modules/ops/desk/components/DeskPage";
import { DeskRunners } from "../../modules/safety/runners/components/DeskRunners";
import {
  banUserAction,
  deskRunnersQuery,
  forceRenameAction,
  keepAccountAction,
  sendDeletionLinkAction,
  unbanUserAction,
} from "../../modules/safety/functions";
import { runnersFilterInput } from "../../modules/safety/client";

/**
 * Desk · Runners, "D8" (round 27 #22): every account, a search, and the
 * selected runner's Rename and Close account — or, once closed, Reopen
 * and the deletion link (round 64 #372). Behind `/desk`'s not-found
 * gate like every page under it; the server functions check again.
 */
export const Route = createFileRoute("/desk/runners")({
  validateSearch: runnersFilterInput,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => deskRunnersQuery({ data: deps }),
  component: RunnersPage,
});

function RunnersPage() {
  const { runners, counts, now } = Route.useLoaderData();
  const filter = Route.useSearch();

  return (
    <DeskPage current="runners">
      <DeskRunners
        runners={runners}
        counts={counts}
        filter={filter}
        now={now}
        rename={forceRenameAction}
        ban={banUserAction}
        unban={unbanUserAction}
        keep={keepAccountAction}
        sendLink={sendDeletionLinkAction}
      />
    </DeskPage>
  );
}
