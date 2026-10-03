/**
 * Facts about the signed-in runner that the browser may keep until the
 * session changes, so a navigation does not have to ask the server again.
 *
 * Only for a fact that **cannot become false while the session lasts
 * without the server saying so**. "Has a handle" is the one today — the
 * root gate's answer (`modules/account/route-decisions`' `gateOnHandle`),
 * which also means the account was not leaving and the published terms
 * were accepted when it was asked. A claimed handle is renamed, never
 * cleared, and leaving is something this tab asks for itself; but a deploy
 * can publish newer terms under an open tab (task 126, ACC-6). That one is
 * not a guess left to go stale: every server function then refuses the
 * runner (`TERMS_NOT_ACCEPTED`), and the refusal's answer forgets the memo
 * (`ui/terms-refusal`, decision D-96), so the next navigation asks again.
 * Anything that can flip back with no refusal to say so belongs in a
 * loader.
 *
 * **Keyed to the runner.** A fact is remembered *for a user id*, and is
 * only read back while that runner is still the one the browser last
 * heard was signed in. That last-heard owner lives in `localStorage`,
 * which every tab shares: the memo itself is per tab, so without it a
 * sign-in as somebody else in a second tab would leave this tab answering
 * from the first runner's facts (review of PR #119). Every answer from the
 * server names its runner (`noteSessionOwner`), and every sign-in and
 * sign-out clears the owner, so any tab's change of account unkeys every
 * other tab's memo.
 *
 * Where `localStorage` is missing or refused — the Worker isolate, a
 * browser blocking site data — the owner is kept in this module instead,
 * which is exactly as good as a single tab can be.
 *
 * **Browser only.** Module state in a Worker isolate is shared by every
 * request it serves, so a fact remembered during one runner's server
 * render would be read during the next runner's. Callers pass whether they
 * are in the browser and remember nothing when they are not.
 */

/**
The shared key. Changing it only costs every tab one extra question.
*/
const OWNER_KEY = "dialed.run:session-owner";

interface OwnerStore {
  readonly read: () => string | undefined;
  readonly write: (owner: string | undefined) => void;
}

/**
 * This tab's own answer, held in a closure rather than a module-level
 * object. A plain `{ owner: undefined }` literal is indistinguishable from
 * `{}` until something reads the (absent) key back — Stryker proved it, and
 * a closed-over `let` has no key to drop.
 */
function tabScopedStore(): OwnerStore {
  let owner: string | undefined;
  return {
    read: () => owner,
    write: (next) => {
      owner = next;
    },
  };
}

const tabStore: OwnerStore = tabScopedStore();

function sharedStore(storage: Storage): OwnerStore {
  return {
    read: () => storage.getItem(OWNER_KEY) ?? undefined,
    write: (owner) => {
      if (owner === undefined) storage.removeItem(OWNER_KEY);
      else storage.setItem(OWNER_KEY, owner);
    },
  };
}

/**
 * The shared store when there is one. Reading `localStorage` itself throws
 * in a browser set to block site data, so the probe is guarded too.
 */
function ownerStore(): OwnerStore {
  try {
    return "localStorage" in globalThis
      ? sharedStore(globalThis.localStorage)
      : tabStore;
  } catch {
    return tabStore;
  }
}

function writeOwner(owner: string | undefined): void {
  try {
    ownerStore().write(owner);
  } catch {
    // Nothing is remembered below without a readable owner, so a failed
    // write only means asking again.
  }
}

/**
 * Each runner's facts, as `[userId, fact]` pairs. A fact about a runner
 * stays true while any session of theirs lasts, so one that signs back in
 * finds theirs again; what decides whether one is read is who the owner
 * is now. A pair with no owner (`[null, fact]` once serialised) is never
 * added, so a read for nobody misses on its own, with no guard to write.
 */
const remembered = new Set<string>();

function pair(owner: string | undefined, fact: string): string {
  return JSON.stringify([owner, fact]);
}

/**
The server said who is signed in, or that nobody is.
*/
export function noteSessionOwner(userId: string | undefined): void {
  writeOwner(userId);
}

export function rememberForSession(userId: string, fact: string): void {
  writeOwner(userId);
  remembered.add(pair(userId, fact));
}

/**
 * A refused read (a full or blocked store, or the store itself unreachable)
 * is the same as no owner: the next navigation asks, which is always
 * correct. The `false` in the `catch` is a literal on purpose — it is what
 * a caught failure means, not a stand-in for the lookup's own `undefined`,
 * which is a different value even though both read as "no".
 */
export function isRememberedForSession(fact: string): boolean {
  try {
    return remembered.has(pair(ownerStore().read(), fact));
  } catch {
    return false;
  }
}

/**
 * Called by every change of who is signed in that does not reload the
 * page — signing in and signing out (`auth/credentials`) — and by a
 * refusal that says a remembered fact has gone stale (`ui/terms-refusal`).
 * Clearing the shared owner is what tells the other tabs. A Google sign-in
 * comes back through a full page load, which starts this module empty and
 * asks.
 */
export function forgetSession(): void {
  remembered.clear();
  writeOwner(undefined);
}
