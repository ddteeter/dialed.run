/**
 * Loads what only a signed-in viewer is shown, and nothing for anyone
 * else: the signed-in landing's handle and bell (R57·271), which a signed-
 * out visitor's page must not ask for (each read needs a session). Here,
 * not in the route, because a route is glue and holds no branch.
 */
export async function signedInOnly<T>(
  session: object | null | undefined,
  load: () => Promise<T>,
): Promise<T | undefined> {
  // `getSession` answers null signed out; nothing else is falsy here.
  return session ? load() : undefined;
}
