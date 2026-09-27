/**
 * Facts about the signed-in runner that the browser may keep until the
 * session changes, so a navigation does not have to ask the server again.
 *
 * Only for a fact that **cannot become false while the session lasts**:
 * "this runner has a handle" is the one today — a claimed handle is
 * renamed, never cleared — so remembering it is exact, not a guess that
 * goes stale. Anything that can flip back belongs in a loader.
 *
 * **Browser only.** Module state in a Worker isolate is shared by every
 * request it serves, so a fact remembered during one runner's server
 * render would be read during the next runner's. Callers pass whether they
 * are in the browser and remember nothing when they are not.
 *
 * `forgetSession` is called by every change of who is signed in that does
 * not reload the page — signing in and signing out (`auth/credentials`).
 * A Google sign-in comes back through a full page load, which starts this
 * module empty anyway.
 */

const remembered = new Set<string>();

export function rememberForSession(fact: string): void {
  remembered.add(fact);
}

export function isRememberedForSession(fact: string): boolean {
  return remembered.has(fact);
}

export function forgetSession(): void {
  remembered.clear();
}
