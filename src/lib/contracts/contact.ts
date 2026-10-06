/**
 * The addresses a runner is told to write to, each written once.
 *
 * Isomorphic so the email module (server) and a component that shows an
 * address (client) both read it here, rather than each holding a copy
 * that drifts. `test/architecture/contact-addresses.test.ts` fails on a
 * literal anywhere else in `src/`.
 *
 * Every `@dialed.run` address forwards to the owner (decision D-62), so
 * both reach a person.
 */

/**
 * The general address: the From line on every email (round 26's "FROM
 * dialed.run <hello@dialed.run>"), and where a runner writes about their
 * account. The terms' "General questions" line.
 */
export const CONTACT_ADDRESS = "hello@dialed.run";

/**
 * Where a moderation decision is appealed: Operator Screens D4's notice
 * and the terms' "Moderation and appeals" line (decision D-73). The
 * moderation emails take it as their Reply-To, so replying to one — the
 * appeal the ban email offers — lands in the same inbox.
 */
export const APPEAL_ADDRESS = "desk@dialed.run";
