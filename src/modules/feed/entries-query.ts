import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SelectedFields } from "drizzle-orm/sqlite-core";

import { outfitEntries } from "../../db/schema-core";

/**
 * The `select … from outfit_entries where …` skeleton both of this
 * module's "recent public entries" reads build on: H's page in
 * `profiles.ts` (one runner, ordered, LIMITed) and consensus's aggregate
 * window in `consensus.ts` (every runner, unordered, un-LIMITed).
 *
 * The two stay separate functions with separate names, columns and
 * `WHERE`s — merging their callers would recouple exactly what PR #102's
 * review pulled apart (see each call site's own comment). What they do
 * share, down to the token, is the `select`/`from` shape underneath, so
 * that much lives here once rather than being retyped in both files.
 */
export function outfitEntriesSelect<TSelection extends SelectedFields>(
  database: DrizzleD1Database,
  columns: TSelection,
  where: SQL | undefined,
) {
  return database.select(columns).from(outfitEntries).where(where);
}
