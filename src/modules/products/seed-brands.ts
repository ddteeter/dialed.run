/**
 * Curated running-brand seed (~50 brands), applied idempotently at runtime.
 *
 * Open question (docs/designs/101-closet.md): the packet describes this as
 * "migration-seeded"; migrations are a forbidden zone for this lane, so v1
 * seeds via `INSERT OR IGNORE` on first use instead. A follow-up data
 * migration with the same `INSERT OR IGNORE INTO brands …` statements can
 * replace this call site with zero behavior change if a human reviewer
 * would rather own it that way.
 */
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { brands } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { normalizeIdentity } from "../../lib/normalize";

type Db = ReturnType<typeof drizzle>;

export const CURATED_BRANDS: readonly string[] = [
  "Nike",
  "Adidas",
  "Brooks",
  "Saucony",
  "Asics",
  "New Balance",
  "Hoka",
  "On",
  "Altra",
  "Mizuno",
  "Salomon",
  "Merrell",
  "Under Armour",
  "The North Face",
  "Patagonia",
  "Arc'teryx",
  "Rab",
  "Montane",
  "Craft",
  "Icebreaker",
  "Smartwool",
  "Darn Tough",
  "Feetures",
  "Balega",
  "Tracksmith",
  "Janji",
  "Ciele Athletics",
  "District Vision",
  "Rabbit",
  "Bandit Running",
  "Satisfy",
  "Soar Running",
  "Iffley Road",
  "Path Projects",
  "Cotopaxi",
  "Outdoor Voices",
  "Lululemon",
  "Gymshark",
  "2XU",
  "Compressport",
  "CEP",
  "Injinji",
  "Buff",
  "Nathan",
  "UltrAspire",
  "Orange Mud",
  "Naked Running Band",
  "Goodr",
  "Oakley",
  "Julbo",
  "Precision Fit",
] as const;

/**
 * Insert every curated brand that isn't already present, keyed by normalized
 * name. Safe to call on every cold start / autocomplete request: once seeded,
 * every insert is a no-op (`OR IGNORE` on the UNIQUE(normalized) index).
 */
export async function ensureBrandsSeeded(db: Db): Promise<void> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(brands)
    .where(sql`${brands.seeded} = 1`);
  if ((row?.count ?? 0) > 0) return;

  const statements = CURATED_BRANDS.map((name) =>
    db
      .insert(brands)
      .values({
        id: newUlid(),
        name,
        normalized: normalizeIdentity(name),
        seeded: 1,
      })
      .onConflictDoNothing({ target: brands.normalized }),
  );
  const [first, ...rest] = statements;
  if (!first) return;
  // db.batch() over a hand-rolled loop (CLAUDE.md "D1 query discipline"):
  // one round trip for the whole curated list instead of ~50.
  await db.batch([first, ...rest]);
}
