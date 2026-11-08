/**
 * The marketing site (D-99): where the invite is asked for and the product
 * is explained. It isn't a route of this app, so it's addressed by origin.
 *
 * In `lib/` because both sides need it. A component links to it (the
 * public pages' "What is dialed.run?"), and the request-access endpoint
 * redirects to it and checks that a Turnstile challenge was solved on it
 * (design 187). Isomorphic: no env, nothing constructed.
 */
export const MARKETING_ORIGIN = "https://dialed.run";

/**
 * The marketing site's host, as Turnstile's `siteverify` names the site a
 * challenge was solved on.
 */
export const MARKETING_HOST = "dialed.run";

/**
 * The marketing site's ask-for-an-invite page (round 31): M5's form posts
 * from it, and its `?error=` states are drawn there.
 */
export const MARKETING_INVITE_URL = `${MARKETING_ORIGIN}/invite`;
