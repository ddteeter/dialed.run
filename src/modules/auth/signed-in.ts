/**
 * What the root's loader hands every page about who is signed in
 * (`signedInQuery`): whether anyone is — the system states' frame (round
 * 22, X1/X2) — and their address.
 *
 * The address is kept by the page for the one moment the server can no
 * longer say who this was: a save refused because the session lapsed,
 * which carries it to log-in (Au7, `ui/session-lapse`). The runner's own
 * address, on the runner's own page.
 *
 * Out of `functions.ts` so it can be tested: that file pulls TanStack
 * Start's virtual entry, and nothing that reaches it is importable by a
 * test.
 */
export function signedInOf(
  session: Readonly<{ user: Readonly<{ email: string }> }> | null,
): { signedIn: boolean; email: string | undefined } {
  return { signedIn: session !== null, email: session?.user.email };
}
