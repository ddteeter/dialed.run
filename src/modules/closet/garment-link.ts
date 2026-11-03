/**
 * A garment's product link, if it may still be shown (design 163).
 *
 * **The one read every surface asks.** Garment detail, kit detail D and
 * the public kit page all show a runner's link, and each must drop the
 * same links: one that does not parse, one that is not https, and one
 * whose domain an operator has denied — since it was saved, too, which is
 * the case a check at save cannot cover. /kit once read the denylist
 * itself; a second copy of the rule is one that can disagree, and the
 * disagreement is a denied link on the open web.
 *
 * Server-only: the denylist is in D1. The anchor itself is `ui`'s
 * `ProductLink`, which takes what this returns.
 */
import type { drizzle } from "drizzle-orm/d1";

import { domainOf } from "../../lib/domain";
import { isUnconfirmed } from "../account";
import { abandonedBefore } from "../enrichment";
import type { ProductForDetail } from "../products";
import { deniedDomainsOf } from "../safety";
import { isTapListPlaceholder } from "./tap-list-placeholder";

type Db = ReturnType<typeof drizzle>;

/**
 * What enrichment made of a garment's link, as E's one line under it says
 * (round 43 #94). `source` is the domain of the page that was read — the
 * product's first pasted link, which may be another runner's — or
 * `undefined` when that domain is denied, and the line names no site.
 */
export type LinkOutcome =
  | Readonly<{ kind: "found"; source: string | undefined }>
  | Readonly<{ kind: "nothing"; source: string | undefined }>
  | Readonly<{
      kind: "unread";
      source: string | undefined;
      isRetrying: boolean;
    }>
  | Readonly<{ kind: "reading" }>
  | Readonly<{ kind: "noIdentity" }>
  | Readonly<{ kind: "unconfirmed" }>;

/**
 * Garment detail's link, its outcome, and the site its specs came from
 * (design 163). `link` is the shared read's answer, so a denied link is
 * absent and so is its line (round 43 #95). `specSource` is for the
 * composition kicker, which names its source whether or not this garment
 * carries a link of its own.
 */
export interface LinkDetail {
  readonly link: string | undefined;
  readonly outcome: LinkOutcome | undefined;
  readonly specSource: string | undefined;
}

type Extraction = ProductForDetail["extraction"];

/**
 * Why a garment with no product had nothing read. A brand and a model are
 * what make a product, and "no brand" wins over "unconfirmed" (round 43
 * #94): confirming would still read nothing.
 */
async function unlinkedOutcome(
  db: Db,
  garment: GarmentForLink,
): Promise<LinkOutcome> {
  const hasIdentity =
    (garment.brand ?? "").trim() !== "" && !isTapListPlaceholder(garment);
  return hasIdentity && (await isUnconfirmed(db, garment.userId))
    ? { kind: "unconfirmed" }
    : { kind: "noIdentity" };
}

/**
 * A linked product's outcome. `none` reads as `reading`: a product with a
 * link and no claim is one whose claim failed, and the next save asks
 * again.
 */
function linkedOutcome(
  extraction: Extraction,
  source: string | undefined,
): LinkOutcome {
  switch (extraction.status) {
    case "done": {
      return { kind: extraction.hasSpecs ? "found" : "nothing", source };
    }
    case "failed": {
      // The sweep re-drives a failure for the product's first day, so the
      // line says it is trying again until the sweep stops.
      return {
        kind: "unread",
        source,
        isRetrying: extraction.createdAt > abandonedBefore(),
      };
    }
    default: {
      return { kind: "reading" };
    }
  }
}

type GarmentForLink = Readonly<{
  id: string;
  userId: string;
  category: string;
  name: string;
  brand: string | null;
  productUrl: string | null;
}>;

/**
 * Garment detail's link and what came of it, in one denylist read for the
 * garment's link and the page its product read.
 */
export async function linkDetailOf(
  db: Db,
  garment: GarmentForLink,
  extraction: Extraction | undefined,
): Promise<LinkDetail> {
  const denied = await deniedDomainsOf(db, [
    garment.productUrl ?? undefined,
    extraction?.sourceUrl,
  ]);
  // No branch for a source with no domain: it is `undefined` either way,
  // and "undefined" is never a denied host.
  const sourceDomain = domainOf(extraction?.sourceUrl);
  const specSource = denied.has(String(sourceDomain))
    ? undefined
    : sourceDomain;
  const linkDomain = domainOf(garment.productUrl ?? undefined);
  if (linkDomain === undefined || denied.has(linkDomain)) {
    return { link: undefined, outcome: undefined, specSource };
  }
  const outcome =
    extraction === undefined
      ? await unlinkedOutcome(db, garment)
      : linkedOutcome(extraction, specSource);
  return { link: String(garment.productUrl), outcome, specSource };
}

/**
 * The links of these garments that may be shown, keyed by garment id; a
 * garment with none to show is absent. One read of the denylist for the
 * whole batch, on the caller's handle — a page's replica (owner Q4).
 */
export async function allowedLinksOf(
  db: Db,
  garments: readonly Readonly<{ id: string; productUrl: string | null }>[],
): Promise<Map<string, string>> {
  const denied = await deniedDomainsOf(
    db,
    garments.map((garment) => garment.productUrl ?? undefined),
  );
  const allowed = new Map<string, string>();
  for (const { id, productUrl } of garments) {
    const domain = domainOf(productUrl ?? undefined);
    if (domain === undefined || denied.has(domain)) continue;
    allowed.set(id, String(productUrl));
  }
  return allowed;
}
