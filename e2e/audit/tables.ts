/**
 * The tables the audit seeds write, in the order foreign keys need: parents
 * first (design 205). The row types are read from the tables, so a planner's
 * rows and the writer's inserts cannot disagree about which tables exist.
 */
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { user } from "../../src/db/schema-auth";
import {
  accessRequests,
  accountDeletions,
  blocks,
  brands,
  copyrightHolds,
  entryPhotos,
  entryTags,
  follows,
  gaveUp,
  inviteCodes,
  inviteRedemptions,
  moderationActions,
  notifications,
  outfitEntries,
  outfitEntryItems,
  productCorrections,
  products,
  quarantinedContent,
  reactions,
  reports,
  reviewQueue,
  runConditions,
  runs,
  takedownRequests,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";

/**
The insert rows of each table in `T`, under the table's own name.
*/
export type RowsOf<T extends Readonly<Record<string, SQLiteTable>>> = {
  [K in keyof T]: T[K]["$inferInsert"][];
};

/**
What the dense seed writes to the core database.
*/
export const coreTables = {
  user,
  userProfiles,
  brands,
  products,
  wardrobeItems,
  runs,
  outfitEntries,
  outfitEntryItems,
  entryTags,
  entryPhotos,
  runConditions,
  follows,
  reactions,
  notifications,
  reviewQueue,
  reports,
  moderationActions,
  accountDeletions,
  productCorrections,
  inviteCodes,
  inviteRedemptions,
  accessRequests,
  gaveUp,
};

/**
What the gaps seed writes to the core database.
*/
export const gapTables = {
  user,
  userProfiles,
  blocks,
  entryPhotos,
  reviewQueue,
  takedownRequests,
  moderationActions,
  copyrightHolds,
  quarantinedContent,
};
