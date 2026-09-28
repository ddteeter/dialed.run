import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { DeskAccess } from "../../modules/account/components/DeskAccess";
import {
  accessDeskQuery,
  createInviteCodeFn,
  declineRequestFn,
  inviteFromRequestFn,
  restoreInviteCodeFn,
  revokeInviteCodeFn,
} from "../../modules/account/functions";
import { DeskShell } from "../../modules/ops/components/DeskShell";

const desk = getRouteApi("/desk");

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
  const today = desk.useLoaderData();
  const access = Route.useLoaderData();
  const router = useRouter();

  return (
    <DeskShell current="access" today={today}>
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
    </DeskShell>
  );
}
