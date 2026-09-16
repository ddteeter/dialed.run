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

  // The brand's name is carried on the group rather than read back off
  // its first row later: every row in a group has it, so a `[0]` there
  // needed a `?? ""` for a group that cannot be empty, and an
  // unreachable fallback is a branch no test can ever reach.
  const byBrand = new Map<string, { brand: string; rows: typeof rows }>();
  for (const row of rows) {
    const existing = byBrand.get(row.brandId);
    if (existing === undefined) {
      byBrand.set(row.brandId, { brand: row.brandName, rows: [row] });
    } else existing.rows.push(row);
  }

  // No length guard on the cluster: `clustersIn` never returns one
  // shorter than two, so a check here would be a branch no input can
  // reach — dead code that reads like caution.
  const found: DuplicateCandidate[] = [];
  for (const { brand, rows: group } of byBrand.values()) {
    const names = group.map((row) => row.normalizedName);
    for (const cluster of clustersIn(names)) {
      found.push(candidateFrom(brand, group, cluster));
    }
  }
  return found;
}

function candidateFrom(
  brand: string,
  group: readonly { id: string; name: string; normalizedName: string }[],
  cluster: readonly string[],
): DuplicateCandidate {
  return {
    brand,
    // Filtered to the cluster: a brand with four products and one
    // near-miss pair must report the pair, not the catalogue.
    products: group
      .filter((row) => cluster.includes(row.normalizedName))
      .map((row) => ({
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
  const leftTokens = tokensOf(left);
  const rightTokens = tokensOf(right);

  // A one-word name against a two-word one shares too little to be worth
  // an operator's attention: "tight" and "thermal tight" are as likely to
  // be two products as one.
  if (Math.min(leftTokens.length, rightTokens.length) < 2) return false;

  // **One pass over aligned positions, not two rules.** This was a pair
  // of functions — same-length names compared position by position, and
  // different-length ones checked for a prefix — and splitting them cost
  // two bugs. The same-length half found the odd token and then looked
  // its VALUE up with `indexOf`, which is the first position holding that
  // token and not the position that differed: "tight tight" against
  // "tight light" compared position 0 with itself and called two
  // different garments a duplicate. And the different-length half needed
  // guards for positions that could not be missing.
  //
  // Padding the shorter list makes both the same question — where do
  // these two names disagree, and is that one place a spelling or a
  // tacked-on marker — and makes the padding reachable instead of
  // defensive.
  const differing = alignedTokens(leftTokens, rightTokens).filter(
    ([one, other]) => one !== other,
  );
  const [pair, ...rest] = differing;
  if (pair === undefined || rest.length > 0) return false;

  // No special case for a padded position. `areSpellingsOfOneWord("",
  // "24")` already answers exactly what a trailing-marker check would:
  // the empty string is a prefix of everything, so the whole question
  // becomes the length difference — the same `<= 2` that was written
  // twice before, once per branch.
  const [one, other] = pair;
  return areSpellingsOfOneWord(one, other);
}

function tokensOf(name: string): string[] {
  return name.split(" ").filter((token) => token !== "");
}

/**
 * The two token lists side by side, the shorter padded with `""`.
 *
 * Padding can only ever fall at the tail, so a padded position IS the
 * extra token — and a name with two extra tokens shows up as two
 * disagreements, which is what makes an explicit length comparison
 * unnecessary.
 */
function alignedTokens(
  left: readonly string[],
  right: readonly string[],
): (readonly [string, string])[] {
  const length = Math.max(left.length, right.length);
  return Array.from(
    { length },
    (_, index) => [left[index] ?? "", right[index] ?? ""] as const,
  );
}

/**
 * "tight" and "tights", not "tight" and "short".
 *
 * A prefix relationship with a short tail, rather than an edit distance:
 * Levenshtein at this threshold pairs "tight" with "light", which is two
 * different garments and exactly the kind of false pair that makes a
 * report get ignored.
 *
 * It is also what decides a trailing marker, because a padded position
 * asks the same question with one side empty: "short 2" is the same
 * short ("" against "2"), "short winter" is a different garment (""
 * against "winter").
 *
 * Asked in both directions rather than by sorting the two by length,
 * because which one is longer does not matter and the comparison that
 * decided it was an equivalent mutant — `<` and `<=` pick differently
 * only for equal-length strings, where neither can be a proper prefix of
 * the other anyway.
 */
function areSpellingsOfOneWord(left: string, right: string): boolean {
  if (!left.startsWith(right) && !right.startsWith(left)) return false;
  return Math.abs(left.length - right.length) <= 2;
}
