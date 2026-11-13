import { createFileRoute } from "@tanstack/react-router";

import { DeskCodes } from "../../modules/account/components/DeskCodes";
import {
  accessDeskQuery,
  createInviteCodeFn,
  restoreInviteCodeFn,
  revokeInviteCodeFn,
} from "../../modules/account/functions";
import { DeskPage, useDeskToday } from "../../modules/ops/components/DeskPage";

/**
 * Desk D7 · Codes, its own destination since R55·194 (drawn in R55·200),
 * behind the `/desk` layout's not-found for anyone who is not an
 * operator, and every server function behind `requireAdmin` besides.
 */
export const Route = createFileRoute("/desk/codes")({
  loader: async () => accessDeskQuery(),
  component: CodesPage,
});

const ACTIONS = {
  createCode: createInviteCodeFn,
  revoke: revokeInviteCodeFn,
  restore: restoreInviteCodeFn,
};

function CodesPage() {
  const { codes } = Route.useLoaderData();
  const { asOf } = useDeskToday();
  return (
    <DeskPage current="codes">
      <DeskCodes codes={codes} asOf={asOf} actions={ACTIONS} />
    </DeskPage>
  );
}
