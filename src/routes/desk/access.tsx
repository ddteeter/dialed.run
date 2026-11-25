import { createFileRoute } from "@tanstack/react-router";

import { DeskAccess } from "../../modules/account/access/components/DeskAccess";
import { deskAccessSearch } from "../../modules/account/client";
import {
  accessDeskQuery,
  declineRequestFn,
  inviteFromRequestFn,
} from "../../modules/account/functions";
import {
  DeskPage,
  useDeskToday,
} from "../../modules/ops/desk/components/DeskPage";

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20): the requests, behind
 * the `/desk` layout's not-found for anyone who is not an operator, and
 * every server function behind `requireAdmin` besides. Codes are their
 * own page (R55·194, `/desk/codes`).
 */
export const Route = createFileRoute("/desk/access")({
  validateSearch: deskAccessSearch,
  loaderDeps: ({ search: { after } }) => ({ after }),
  loader: async ({ deps: { after } }) => accessDeskQuery({ data: { after } }),
  component: AccessPage,
});

function AccessPage() {
  const { requests, waiting, next } = Route.useLoaderData();
  return (
    <DeskPage current="access">
      <DeskAccess
        requests={requests}
        waiting={waiting}
        next={next}
        after={Route.useSearch().after}
        asOf={useDeskToday().asOf}
        sendInvite={inviteFromRequestFn}
        decline={declineRequestFn}
      />
    </DeskPage>
  );
}
