/**
 * The suspected-CSAM quarantine's record (task 128 · SAF-5; decision
 * D-70): `quarantined_content`, written once and read only by an admin.
 *
 * The rows a quarantine deletes are copied here first, in the same batch,
 * so they are hidden from every read at once — no read anywhere has to
 * remember a filter — and still exist, with who uploaded them and when,
 * for the owner's report to NCMEC's CyberTipline. Kept a year
 * (`QUARANTINE_RETENTION_SECONDS`).
 */
import { desc } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { quarantinedContent } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";

import { requireAdmin } from "./admin";

type Db = ReturnType<typeof drizzle>;

/**
One year, the preservation the owner set (D-70).
*/
export const QUARANTINE_RETENTION_SECONDS = 365 * 24 * 60 * 60;

export type QuarantineRecord = Omit<
  typeof quarantinedContent.$inferInsert,
  "id" | "retainUntil"
>;

/**
 * The row, as a statement for the caller's batch — the same batch as the
 * deletes it preserves, so the rows are never gone without their copy.
 */
export function quarantineInsert(db: Db, record: QuarantineRecord) {
  return db.insert(quarantinedContent).values({
    id: newUlid(),
    ...record,
    retainUntil: record.quarantinedAt + QUARANTINE_RETENTION_SECONDS,
  });
}

/**
The most records one read returns.
*/
export const QUARANTINE_PAGE = 100;

/**
 * What is in quarantine, newest first — for an admin only. Anyone else
 * is refused with `AdminRequiredError`, before anything is read.
 */
export async function quarantinedContentFor(db: Db, viewerId: string) {
  requireAdmin(viewerId);
  return db
    .select()
    .from(quarantinedContent)
    .orderBy(desc(quarantinedContent.quarantinedAt))
    .limit(QUARANTINE_PAGE);
}
