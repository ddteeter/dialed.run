/**
 * Link hygiene for product URLs (packet §3).
 *
 * https-only is already enforced in 101, so this file owns the half that
 * was not: the denylist check, and the bare domain the UI renders next to
 * the link text so a runner can see where a link goes before following it.
 *
 * `rel="ugc nofollow noopener"` belongs to whichever component renders the
 * anchor, not here — a function that returns a domain has no business
 * knowing about HTML attributes.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { domainDenylist } from "../../db/schema-core";
import { env } from "../../env";
import { domainOf } from "../../lib/domain";
import { hasRowWhere } from "../../lib/keyed-read";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
 * Whether this URL's domain is denied. A URL we cannot parse is not
 * denied — it is invalid, which is a different answer with a different
 * message, and conflating them would tell a runner their perfectly good
 * link was blocked.
 */
export async function isDeniedDomain(
  url: string | undefined,
): Promise<boolean> {
  // No guard for an absent url: `domainOf` answers `undefined` for one,
  // which is the same answer it gives an unparseable string and leads to
  // the same "not denied" below. A check here would be a branch nothing
  // could distinguish.
  const domain = domainOf(url);
  if (domain === undefined) return false;
  return hasRowWhere(
    db(),
    domainDenylist,
    domainDenylist.domain,
    eq(domainDenylist.domain, domain),
  );
}

/**
 * Adds a domain to the denylist. Seeded empty (packet §3); the review flow
 * is what fills it.
 *
 * The stored form is whatever `domainOf` produces, so a reviewer pasting a
 * full URL and a reviewer typing a bare host both land on the same row.
 */
export async function denyDomain(
  domainOrUrl: string,
  addedBy: string,
  reason?: string,
): Promise<void> {
  const domain = domainOf(domainOrUrl) ?? normalizeBareDomain(domainOrUrl);
  await db()
    .insert(domainDenylist)
    .values({
      domain,
      addedBy,
      reason,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

/**
 * A host typed without a scheme, in the same shape `domainOf` returns.
 */
function normalizeBareDomain(value: string): string {
  const host = value.trim().toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}
