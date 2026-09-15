/**
 * The probable-duplicate products report (D-30, packet §2b).
 *
 * **Read-only, and that is the whole scope.** D-30 is explicit: dedup in
 * v1 is normalisation plus autocomplete steering, and merge tooling is a
 * post-v1 micro-task. So this makes the mess visible and does nothing
 * about it — which is worth building precisely because "some dirt is
 * accepted" is a decision that needs a way to see how much dirt.
 *
 * `products_brand_name` already makes an exactly-normalised collision
 * impossible, so everything reported here is a NEAR miss the create-if-
 * missing key could not catch: a stray word, a plural, a model number
 * written two ways.
 */
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { brands, products } from "../../db/schema-core";
import { env } from "../../env";

function db() {
  return drizzle(env.DIALED_CORE);
}

export interface DuplicateCandidate {
  brand: string;
  /**
  The rows that look like the same product, most recent first.
  */
  products: readonly { id: string; name: string; normalizedName: string }[];
}

/**
 * Products under one brand whose normalised names are near-identical.
 *
 * **Grouped by brand first, and only then compared.** Two products called
 * "Thermal Tight" from different brands are two different products, and a
 * report that pairs them is one an operator stops reading.
 */
export async function duplicateProducts(
  limit = 500,
): Promise<DuplicateCandidate[]> {
  const rows = await db()
    .select({
      id: products.id,
      name: products.name,
      normalizedName: products.normalizedName,
      brandId: products.brandId,
      brandName: brands.name,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .orderBy(asc(products.brandId), asc(products.normalizedName))
    .limit(limit);

  const byBrand = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byBrand.get(row.brandId);
    if (existing === undefined) byBrand.set(row.brandId, [row]);
    else existing.push(row);
  }

  // No length guard on the cluster: `clustersIn` never returns one
  // shorter than two, so a check here would be a branch no input can
  // reach — dead code that reads like caution.
  const found: DuplicateCandidate[] = [];
  for (const group of byBrand.values()) {
    const names = group.map((row) => row.normalizedName);
    for (const cluster of clustersIn(names)) {
      found.push(candidateFrom(group, cluster));
    }
  }
  return found;
}

function candidateFrom(
  group: readonly {
    id: string;
    name: string;
    normalizedName: string;
    brandName: string;
  }[],
  cluster: readonly string[],
): DuplicateCandidate {
  const members = group.filter((row) => cluster.includes(row.normalizedName));
  return {
    brand: members[0]?.brandName ?? "",
    products: members.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalizedName,
    })),
  };
}

/**
 * Groups names that are near-identical.
 *
 * **"Near" means one token apart, not an edit distance.** A Levenshtein
 * threshold pairs "tight" with "light" — different garments — while
 * missing "thermal tight" against "thermal tights 2", which is the shape
 * a real duplicate takes: someone typed the plural, or added the year.
 * Comparing token sets catches the second and refuses the first.
 */
export function clustersIn(names: readonly string[]): string[][] {
  const unique = [...new Set(names)];
  const clusters: string[][] = [];
  const claimed = new Set<string>();

  for (const name of unique) {
    if (claimed.has(name)) continue;
    const cluster = unique.filter(
      (other) => other === name || areNearlyTheSame(name, other),
    );
    if (cluster.length > 1) {
      for (const member of cluster) claimed.add(member);
      clusters.push(cluster);
    }
  }
  return clusters;
}

/**
 * Two normalised names that look like one product typed twice.
 *
 * **The difference has to be WITHIN a token, or a trailing marker.** A
 * first attempt compared token sets and accepted anything one token
 * apart, which pairs "thermal tight" with "thermal short" — two garments
 * sharing a brand's house adjective. Those differ *between* tokens.
 * A real duplicate differs *inside* one ("tight"/"tights") or by a
 * tacked-on marker ("… short"/"… short 2"), and separating those two
 * cases is what keeps the report readable.
 */
function areNearlyTheSame(left: string, right: string): boolean {
  if (left === right) return false;
  const leftTokens = tokensOf(left);
  const rightTokens = tokensOf(right);

  // A one-word name against a two-word one shares too little to be worth
  // an operator's attention: "tight" and "thermal tight" are as likely to
  // be two products as one.
  if (Math.min(leftTokens.length, rightTokens.length) < 2) return false;

  if (leftTokens.length === rightTokens.length) {
    return hasOneDifferingToken(leftTokens, rightTokens);
  }
  return hasOneExtraMarker(leftTokens, rightTokens);
}

function tokensOf(name: string): string[] {
  return name.split(" ").filter((token) => token !== "");
}

/**
 * Same shape, same order, and the single position that differs holds two
 * spellings of the same word.
 */
function hasOneDifferingToken(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const differing = left.filter((token, index) => token !== right[index]);
  if (differing.length !== 1) return false;
  const index = left.indexOf(differing[0] ?? "");
  return areSpellingsOfOneWord(left[index] ?? "", right[index] ?? "");
}

/**
 * One name is the other plus a trailing marker — a year, a version, a
 * "2". The shorter must be a prefix of the longer in order, or these are
 * two different names that happen to start alike.
 */
function hasOneExtraMarker(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (Math.abs(left.length - right.length) !== 1) return false;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  const isPrefix = shorter.every((token, index) => token === longer[index]);
  if (!isPrefix) return false;
  const extra = longer.at(-1) ?? "";
  // A marker, not a whole new word: "short 2" is the same short, "short
  // winter" is a different garment.
  return extra.length <= 2;
}

/**
 * "tight" and "tights", not "tight" and "short".
 *
 * A prefix relationship with a short tail, rather than an edit distance:
 * Levenshtein at this threshold pairs "tight" with "light", which is two
 * different garments and exactly the kind of false pair that makes a
 * report get ignored.
 */
function areSpellingsOfOneWord(left: string, right: string): boolean {
  if (left === "" || right === "") return false;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  if (!longer.startsWith(shorter)) return false;
  return longer.length - shorter.length <= 2;
}
