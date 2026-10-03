import { useNavigate, useRouter } from "@tanstack/react-router";

/**
 * Where a decision page sends a runner next once it is resolved — Accept
 * pressed on the terms prompt (ACC-6): the loader's view is stale, and home
 * is where they land. `router.invalidate()` first, so the page a runner
 * lands on next reads the fresh gate rather than the one that sent them
 * here.
 */
export function useGoHome(): () => Promise<void> {
  const goTo = useGoTo();
  return () => goTo(undefined);
}

/**
 * `useGoHome`, to a path on this site when there is one: invalidated
 * first, for the same reason.
 */
function useGoTo(): (href: string | undefined) => Promise<void> {
  const router = useRouter();
  const navigate = useNavigate();
  return async (href) => {
    await router.invalidate();
    await navigate({ href: href ?? "/" });
  };
}

/**
 * The terms prompt's three ways on (ACC-6), wired: Accept goes back to
 * `from` — where a stale tab's refused call left the runner (decision
 * D-96) — or home without one, Log out signs out and goes home, and a
 * stale Accept reloads the page so it shows the newer terms. `signOut` is
 * the route's to hand in — this module reaches auth only through its
 * barrel, and the browser's sign-out is not on it.
 */
export function useTermsPromptWiring(
  signOut: () => Promise<unknown>,
  from: string | undefined,
): {
  logOut: () => Promise<void>;
  onAccepted: () => Promise<void>;
  onStale: () => Promise<void>;
} {
  const router = useRouter();
  const goHome = useGoHome();
  const goTo = useGoTo();
  return {
    logOut: async () => {
      await signOut();
      await goHome();
    },
    onAccepted: () => goTo(from),
    onStale: () => router.invalidate(),
  };
}
