import { createFileRoute, useRouter } from "@tanstack/react-router";

import { DeskAccess } from "../../modules/account/components/DeskAccess";
import {
  accessDeskQuery,
  createInviteCodeFn,
  declineRequestFn,
  inviteFromRequestFn,
  restoreInviteCodeFn,
  revokeInviteCodeFn,
} from "../../modules/account/functions";
import { DeskPage, useDeskToday } from "../../modules/ops/components/DeskPage";

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20), behind the `/desk`
 * layout's not-found for anyone who is not an operator, and every server
 * function behind `requireAdmin` besides.
 */
export const Route = createFileRoute("/desk/access")({
  loader: async () => accessDeskQuery(),
  component: AccessPage,
});

function AccessPage() {
  const today = useDeskToday();
  const access = Route.useLoaderData();
  const router = useRouter();

  return (
    <DeskPage current="access">
      <DeskAccess
        desk={access}
        asOf={today.asOf}
        linkFor={(code) =>
          new URL(
            router.buildLocation({ to: "/join", search: { code } }).href,
            globalThis.location.origin,
          ).href
        }
        copy={(text) => navigator.clipboard.writeText(text)}
        onChanged={() => router.invalidate()}
        createCode={createInviteCodeFn}
        sendInvite={inviteFromRequestFn}
        decline={declineRequestFn}
        revoke={revokeInviteCodeFn}
        restore={restoreInviteCodeFn}
      />
    </DeskPage>
  );
}
