/**
 * The open web's pages (design 160, D-152): the paths whose HTML is the
 * same for every viewer, so the edge can store it.
 *
 * **Nothing about the viewer may reach their markup**, and the root route
 * reads the session for every other page: the handle gate and the
 * "anyone signed in?" answer the system states frame themselves by. On
 * these paths the root asks neither, so no session read, no redirect and
 * no per-viewer value is ever written into a page the edge keeps. What a
 * signed-in viewer sees differently is filled in the browser, after load.
 *
 * Imports nothing, because the root route imports it and a route is in
 * the client bundle.
 */

/**
`/k/<entryId>`, the public kit (round 41 #86c).
*/
const PUBLIC_KIT_PATH = /^\/k\/[^/]+\/?$/u;

/**
 * `/@<handle>`, the public profile (round 41 #86d) — with the `@` as a
 * browser sends it, or percent-encoded, which the router reads as the same
 * page and so must be the same page here.
 */
const PUBLIC_PROFILE_PATH = /^\/(?:@|%40)[^/]+\/?$/u;

export function isOpenWebPath(pathname: string): boolean {
  return PUBLIC_KIT_PATH.test(pathname) || PUBLIC_PROFILE_PATH.test(pathname);
}

/**
 * The root loader's answer: "nobody", without asking, on an open-web
 * path — the page must not depend on who is looking — and the session's
 * own answer anywhere else.
 */
export async function signedInOffTheOpenWeb(
  pathname: string,
  ask: () => Promise<{ signedIn: boolean }>,
): Promise<{ signedIn: boolean }> {
  return isOpenWebPath(pathname) ? { signedIn: false } : ask();
}
