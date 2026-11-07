import type { ThemeChoice } from "../../lib/contracts";

/**
 * The root's answer about who is signed in, with their theme (design 185).
 *
 * The account's value takes over on sign-in (R48·133), and the root's
 * answer is already the one thing every sign-in and sign-out invalidates,
 * so the theme rides on it rather than on a loader of its own. Signed out
 * it is `system` without asking: "signed out: always system".
 *
 * Out of `theme.ts` because the root route imports it, and a route is in
 * the client bundle: this file imports nothing that runs.
 */
export function withOwnTheme<T extends { signedIn: boolean }>(
  ask: () => Promise<T>,
  askTheme: () => Promise<ThemeChoice>,
): () => Promise<T & { theme: ThemeChoice }> {
  return async () => {
    const who = await ask();
    return { ...who, theme: who.signedIn ? await askTheme() : "system" };
  };
}
