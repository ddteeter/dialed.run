import { useNavigate, useRouter } from "@tanstack/react-router";

/**
 * Where a decision page sends a runner next once it is resolved — Accept
 * pressed on the terms prompt (ACC-6): the loader's view is stale, and home
 * is where they land. `router.invalidate()` first, so the page a runner
 * lands on next reads the fresh gate rather than the one that sent them
 * here.
 */
export function useGoHome(): () => Promise<void> {
  const router = useRouter();
  const navigate = useNavigate();
  return async () => {
    await router.invalidate();
    await navigate({ to: "/" });
  };
}

/**
 * The terms prompt's three ways on (ACC-6), wired: Accept goes home, Log
 * out signs out and goes home, and a stale Accept reloads the page so it
 * shows the newer terms. `signOut` is the route's to hand in — this module
 * reaches auth only through its barrel, and the browser's sign-out is not
 * on it.
 */
export function useTermsPromptWiring(signOut: () => Promise<unknown>): {
  logOut: () => Promise<void>;
  onAccepted: () => Promise<void>;
  onStale: () => Promise<void>;
} {
  const router = useRouter();
  const goHome = useGoHome();
  return {
    logOut: async () => {
      await signOut();
      await goHome();
    },
    onAccepted: goHome,
    onStale: () => router.invalidate(),
  };
}
