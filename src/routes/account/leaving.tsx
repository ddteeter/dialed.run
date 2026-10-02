import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { Leaving } from "../../modules/account/components/Leaving";
import { keepAccountFn, leavingQuery } from "../../modules/account/functions";
import {
  homeIfNothingToSay,
  leavingSearch,
} from "../../modules/account/route-decisions";
import { signOut } from "../../modules/auth/credentials";

/**
 * Round 27 #14's deletion pages (ACC-9): "Your account goes on …" once a
 * runner has asked, signed out; "Keep your account?" when they log in
 * inside the week. Anyone else is sent home.
 */
export const Route = createFileRoute("/account/leaving")({
  validateSearch: leavingSearch,
  loaderDeps: ({ search }) => ({ on: search.on }),
  loader: async ({ deps }) => {
    const view = await leavingQuery({ data: { on: deps.on } });
    homeIfNothingToSay(view);
    return view;
  },
  component: LeavingPage,
});

function LeavingPage() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  return (
    <Leaving
      view={view}
      keep={keepAccountFn}
      logOut={async () => {
        await signOut();
        await router.invalidate();
        await navigate({ to: "/" });
      }}
      onKept={async () => {
        await router.invalidate();
        await navigate({ to: "/" });
      }}
    />
  );
}
