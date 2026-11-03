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
import { inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { domainDenylist } from "../../db/schema-core";
import { primaryCoreDb } from "../../env";
import { domainOf } from "../../lib/domain";
import { columnWhere } from "../../lib/sql/keyed-read";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

// Primary: the denylist is read to refuse a save, and an operator's new
// entry must hold at once (D-123, design 143).
function db() {
  return primaryCoreDb();
}

/**
 * A host and every parent domain above it: `shop.spam.example` is
 * `shop.spam.example` and `spam.example`. A denied row is a registrable
 * host (contracts), so denying it denies everything under it (design 163,
 * owner Q2). The last label alone is never one: it is a TLD, and no
 * reviewer means "every .com".
 */
function suffixesOf(domain: string): string[] {
  const labels = domain.split(".");
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
}

/**
 * Which of these links' domains are denied, in one read of the denylist
 * by its key, whatever the batch size (design 163).
 *
 * **The one rule.** The save's refusal and every surface that shows a link
 * ask this, so a link cannot be refused at save and shown somewhere else,
 * or the reverse. The answer is in `domainOf`'s form, so a caller asks
 * `denied.has(domainOf(url))`.
 *
 * The handle is the caller's: a save's refusal reads the primary, and a
 * page reads its replica (owner Q4), where a new denial lands within the
 * same minute its cache already accepts.
 *
 * A link we cannot parse, or that is not https, is never in the answer —
 * it is invalid, which is a different answer with a different message,
 * and conflating them would tell a runner their perfectly good link was
 * blocked.
 */
export async function deniedDomainsOf(
  database: Db,
  urls: readonly (string | undefined)[],
): Promise<Set<string>> {
  const domains = new Set(
    urls.map((url) => domainOf(url)).filter((domain) => domain !== undefined),
  );
  const candidates = [...domains].flatMap((domain) => suffixesOf(domain));
  const listed = new Set(
    await columnWhere(
      database,
      domainDenylist,
      domainDenylist.domain,
      inArray(domainDenylist.domain, candidates),
    ),
  );
  return new Set(
    [...domains].filter((domain) =>
      suffixesOf(domain).some((suffix) => listed.has(suffix)),
    ),
  );
}

/**
 * Whether this URL's domain is denied: `deniedDomainsOf` for one link, on
 * the primary, for a save's refusal.
 */
export async function isDeniedDomain(
  url: string | undefined,
): Promise<boolean> {
  const denied = await deniedDomainsOf(db(), [url]);
  return denied.size > 0;
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
      createdAt: nowSeconds(),
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
