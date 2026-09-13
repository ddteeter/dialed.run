import type { drizzle } from "drizzle-orm/d1";

import { garmentCategoryLabels } from "../../lib/contracts";
import { listItems } from "../closet";
import type { ClosetItemView, WardrobeItemRow } from "../closet";
import { productsForBrand, searchBrands } from "../products";

type Db = ReturnType<typeof drizzle>;

/**
One generic garment, as P2.5 offers it.
*/
export interface NameableItem {
  itemId: string;
  /**
  What the tap list called it — "Merino base layer".
  */
  label: string;
  /**
   * `TOP · GENERIC`, the Z language verbatim. Design §AC rule Q5: a named
   * row's subtitle becomes the product's type; until then it says what the
   * category is and that nothing more is known.
   */
  subtitle: string;
}

export interface NamingOffer {
  items: readonly NameableItem[];
  /**
  Everything in the closet, named or not — the counter's denominator.
  */
  totalCount: number;
}

/**
 * What P2.5 shows: every generic garment in the closet, in closet order.
 *
 * **Every generic row is offered, and the order carries the suggestion —
 * never a filter** (design §AC rule 01, the same doctrine as §AA's one
 * list). A badge claiming to know a stranger's favourites would be the app
 * asserting something it has not earned.
 *
 * **Design ranks rows worn on a tagged run first, and in v1 none are.**
 * Rule 01 sorts by evidence the runner supplied at O4 — and O4 is bulk
 * history import, explicitly out of scope for this packet (D-13). Rule 02
 * is the branch that covers it: *"With no tagged runs the first heading is
 * absent — not empty. One flat list, closet order."* So v1 always takes
 * the fallback, and the ranked half arrives with O4 rather than being
 * stubbed now against a signal that is always zero.
 *
 * Named pieces are absent rather than shown as done: P2.5 runs once,
 * immediately after the tap list, so in practice everything is generic —
 * and the closet nudge, not this screen, is what follows up later.
 */
export async function namingOffer(
  db: Db,
  userId: string,
): Promise<NamingOffer> {
  const listing = await listItems(db, userId, {});
  return {
    items: listing.items.filter((view) => view.isGeneric).map((view) => toNameable(view)),
    totalCount: listing.totalCount,
  };
}

/**
 * The Z language verbatim — `categoryLabel + " · GENERIC"`.
 *
 * One function because two places say it: the offer list, and a row that
 * has not been named. A row must read identically wherever it appears, and
 * two copies of a separator is how one of them ends up with an en dash.
 *
 * Normal case because it renders in mono, which uppercases in CSS and
 * leaves the accessible name readable.
 */
function genericSubtitle(category: WardrobeItemRow["category"]): string {
  return `${garmentCategoryLabels[category]} · Generic`;
}

function toNameable(view: ClosetItemView): NameableItem {
  return {
    itemId: view.item.id,
    // The name the tap list gave it: a generic row has no brand, so
    // there is nothing to prefix it with.
    label: view.item.name,
    subtitle: genericSubtitle(view.item.category),
  };
}

/**
 * What a row says once someone has named it.
 *
 * `isNamed` is design rule 04's other half: **brand-only is a partial
 * answer**, so that row keeps its own name, says `SMARTWOOL · NO MODEL`,
 * and *stays offered*. Only a linked product finishes it.
 */
export interface NamedResult {
  label: string;
  subtitle: string;
  isNamed: boolean;
}

/**
 * **Design's three payout lines cannot be told in v1** (§AC3, recorded as
 * D-54): nothing writes `products.type` until lane 107's enrichment lands,
 * no read counts the owners of a product, and "your 3 tagged runs" needs
 * O4. So this states what actually happened and nothing more — on the one
 * screen whose entire job, in design's own words, is to be believed.
 */
export function namedResult(row: WardrobeItemRow): NamedResult {
  const brand = row.brand;
  // Three states, and each is one a row can actually be in. An earlier
  // version read `row.brand ?? ""`, whose fallback no input could reach —
  // and reaching for it would have printed a leading " · " anyway. Asking
  // the question in the order the row answers it removes the branch
  // instead of suppressing it.
  if (brand === null) {
    return {
      label: row.name,
      subtitle: genericSubtitle(row.category),
      isNamed: false,
    };
  }
  if (row.productId === null) {
    return { label: row.name, subtitle: `${brand} · No model`, isNamed: false };
  }
  return {
    label: `${brand} ${row.name}`,
    subtitle: `${garmentCategoryLabels[row.category]} · Matched`,
    isNamed: true,
  };
}

/**
 * Brand and model suggestions for the row being named, in one round trip.
 *
 * Both come off the same typed brand: the curated seed list answers "which
 * brand", and that brand's known products answer "which one of theirs" —
 * design's chip row, "typed only if none fit". One query pair per brand
 * keystroke rather than two, because they are one question.
 */
export async function namingSuggestions(
  db: Db,
  brand: string,
): Promise<{ brands: string[]; models: string[] }> {
  const [matched, known] = await Promise.all([
    searchBrands(db, brand),
    productsForBrand(db, brand),
  ]);
  return {
    brands: matched.map((row) => row.name),
    models: known.map((row) => row.name),
  };
}
