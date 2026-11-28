import { and } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../../db/schema-core";
import { runnerVisibleToViewer } from "../../safety/rules";

/**
 * The `select … from user_profiles where …` skeleton runner search and H
 * both build: the three columns either reads a runner by, filtered to
 * safety's `runnerVisibleToViewer` plus the caller's own predicate.
 * Search adds a prefix match and excludes the viewer; H adds
 * `eq(userId, …)`. Extracting this is what keeps that skeleton from being
 * written out twice — a clone `dupes` catches even after the `WHERE` floor
 * was already shared, because the surrounding `select`/`from` was still
 * repeated verbatim.
 *
 * All three columns are selected either way, even though one caller reads
 * only `username`/`cityLabel` and the other only `userId`/`username`: a
 * result no caller asked for is discarded by their own mapping, and never
 * changes which index answers a `WHERE` that does not mention it.
 */
export function runnersVisibleTo(
  database: DrizzleD1Database,
  viewerId: string,
  where: SQL | undefined,
) {
  return database
    .select({
      userId: userProfiles.userId,
      username: userProfiles.username,
      cityLabel: userProfiles.cityLabel,
    })
    .from(userProfiles)
    .where(and(where, runnerVisibleToViewer(viewerId)));
}
