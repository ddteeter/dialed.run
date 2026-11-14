import { createFileRoute } from "@tanstack/react-router";

import { DeskAccess } from "../../modules/account/components/DeskAccess";
import {
  accessDeskQuery,
  declineRequestFn,
  inviteFromRequestFn,
} from "../../modules/account/functions";
import { DeskPage, useDeskToday } from "../../modules/ops/components/DeskPage";

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20): the requests, behind
 * the `/desk` layout's not-found for anyone who is not an operator, and
 * every server function behind `requireAdmin` besides. Codes are their
 * own page (R55·194, `/desk/codes`).
 */
export const Route = createFileRoute("/desk/access")({
  loader: async () => accessDeskQuery(),
  component: () => (
    <DeskPage current="access">
      <DeskAccess
        requests={Route.useLoaderData().requests}
        asOf={useDeskToday().asOf}
        sendInvite={inviteFromRequestFn}
        decline={declineRequestFn}
      />
    </DeskPage>
  ),
});
