/**
 * The curated running-brand list (~50), as data.
 *
 * The packet always described this as migration-seeded; it ran at runtime
 * because migrations were a forbidden zone for this lane. With the owner's
 * go-ahead it is now
 * `src/db/migrations/core/0002_curated_brand_seed.sql`, generated from this
 * list with ids derived from each brand name, so it is re-runnable and a
 * fresh database gets identical rows.
 */

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
 * The list itself stays in code as the source the migration was generated
 * from, and as what a future seed addition edits. Seeding is no longer a
 * runtime concern: src/db/migrations/core/0002_curated_brand_seed.sql
 * inserts these with ids derived from the brand name, so it is
 * re-runnable and produces identical rows on a fresh database.
 *
 * Adding a brand to this list therefore needs a new migration inserting
 * it — deliberately, because "which brands exist" is data, and a runtime
 * guard made it a deploy-shaped question that also cost a count query on
 * every autocomplete cold path.
 */
