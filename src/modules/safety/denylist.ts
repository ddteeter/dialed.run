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

import { domainDenylist, linkLandings } from "../../db/schema-core";
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
 * Which of these domains are denied, by their own row or a parent's, in
 * one read of the denylist by its key, whatever the batch size.
 */
async function deniedAmong(
  database: Db,
  domains: ReadonlySet<string>,
): Promise<Set<string>> {
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
 * Which of these links are denied: by their own domain, or by the domain
 * enrichment found they land on (R-176, design 171). The answer holds the
 * links exactly as given, so a caller asks `denied.has(url)`.
 *
 * **The one rule** (design 163). The save's refusal and every surface that
 * shows a link ask this, so a link cannot be refused at save and shown
 * somewhere else, or the reverse — and a link that redirects somewhere
 * denied is refused and hidden exactly like one typed there.
 *
 * The handle is the caller's: a save's refusal reads the primary, and a
 * page reads its replica (owner Q4), where a new denial lands within the
 * same minute its cache already accepts.
 *
 * A link we cannot parse, or that is not https, is never in the answer —
 * it is invalid, which is a different answer with a different message,
 * and conflating them would tell a runner their perfectly good link was
 * blocked. A batch with no valid link makes no read.
 */
export async function deniedLinksOf(
  database: Db,
  urls: readonly (string | undefined)[],
): Promise<Set<string>> {
  const links = new Map<string, string>();
  const valid: string[] = [];
  for (const url of urls) {
    const domain = domainOf(url);
    if (domain === undefined) continue;
    links.set(String(url), domain);
    valid.push(String(url));
  }
  if (valid.length === 0) return new Set();
  const rows = await database
    .select({ url: linkLandings.url, domain: linkLandings.landedDomain })
    .from(linkLandings)
    .where(inArray(linkLandings.url, valid));
  const landings = new Map(rows.map(({ url, domain }) => [url, domain]));
  const denied = await deniedAmong(
    database,
    new Set([...links.values(), ...landings.values()]),
  );
  return new Set(
    [...links]
      .filter(
        ([url, domain]) =>
          denied.has(domain) || denied.has(String(landings.get(url))),
      )
      .map(([url]) => url),
  );
}

/**
 * Whether this link is denied: `deniedLinksOf` for one link, on the
 * primary, for a save's refusal.
 */
export async function isDeniedLink(url: string | undefined): Promise<boolean> {
  const denied = await deniedLinksOf(db(), [url]);
  return denied.size > 0;
}

/**
 * Whether this link is denied now, by its own domain or the domain
 * enrichment's read of it landed on — and the landing is recorded first,
 * so every later read of the link answers the same way (R-176, design
 * 171). Enrichment asks before it stores anything, and throws the read
 * away on `true`.
 *
 * Only a landing on another domain is a row: a link that lands at home
 * is answered by its own domain, now and at every later read. A landing
 * with no https domain has nothing to hold against the denylist, so its
 * read is refused rather than let past the rule; it leaves no row, so the
 * link itself is not hidden. Only the proxy, following redirects on its
 * own network, can arrive at one.
 *
 * Primary, like the save's refusal: an operator's new denial holds at
 * once, and the landing is a write.
 */
export async function isDeniedOnLanding(
  link: string,
  landedUrl: string,
): Promise<boolean> {
  const landed = domainOf(landedUrl);
  if (landed === undefined) return true;
  if (landed !== domainOf(link)) {
    const checkedAt = nowSeconds();
    await db()
      .insert(linkLandings)
      .values({ url: link, landedDomain: landed, checkedAt })
      .onConflictDoUpdate({
        target: linkLandings.url,
        set: { landedDomain: landed, checkedAt },
      });
  }
  return isDeniedLink(link);
}

/**
 * Adds a domain to the denylist. Seeded with link shorteners and
 * redirectors (R-176, migration 0078); the review flow adds the rest.
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
