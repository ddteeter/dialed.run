import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { SignOutButton } from "../../modules/auth/components/SignOutButton";
import { signOut } from "../../modules/auth/credentials";
import { DeskSignOutProvider } from "../../modules/ops/components/DeskSignOut";
import { operatorOrNotFound } from "../../modules/ops/desk-gate";
import { deskAccessQuery, deskTodayQuery } from "../../modules/ops/functions";

/**
 * The Desk (decision D-35; Operator Screens D0): the door and the data
 * every page under it shares. `beforeLoad` runs before any child's
 * loader, so every page 125, 126 and 128 put under `/desk` is behind the
 * same not-found for anyone who is not an operator. Each page renders
 * `DeskPage` itself, naming which rail entry it is; this layout wires the
 * top bar's Sign out once for all of them (R55·194).
 */
export const Route = createFileRoute("/desk")({
  beforeLoad: async () => {
    operatorOrNotFound(await deskAccessQuery());
  },
  loader: async () => deskTodayQuery(),
  head: () => ({ meta: [{ title: "[desk]" }] }),
  component: DeskLayout,
});

function DeskLayout() {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <DeskSignOutProvider
      value={
        <SignOutButton
          signOut={async () => {
            await signOut();
            // The shell reads "signed in" once, at the root; tell it.
            await router.invalidate();
            await navigate({ to: "/" });
          }}
        />
      }
    >
      <Outlet />
    </DeskSignOutProvider>
  );
}
