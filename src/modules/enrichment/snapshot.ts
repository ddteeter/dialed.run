import { drizzle } from "drizzle-orm/d1";

import { productSnapshots } from "../../db/schema-core";
import { env } from "../../env";
import { newUlid } from "../../lib/ids";

type Db = ReturnType<typeof drizzle>;

/**
The rungs a snapshot can record, read from the column rather than restated.
*/
type SnapshotRung = typeof productSnapshots.$inferInsert.rung;

/**
 * Permanent storage for the page a product was extracted from.
 *
 * **Retention-first, and the ordering carries the whole argument (D-31).**
 * Links rot; snapshots do not. Extraction improves — a better parser, a
 * better model — and every improvement is retroactive only over pages we
 * actually kept. So the bytes are written *before* anything tries to
 * understand them: a parser that throws, or a rung that returns nonsense,
 * must not be able to cost us the page.
 *
 * `MEDIA` is the no-expiry bucket, which is the right one here for the same
 * reason.
 */
export function snapshotKey(productId: string, fetchedAt: number): string {
  return `products/${productId}/snapshot-${String(fetchedAt)}.html`;
}

/**
 * Put the page in R2. Called before parsing, and returns the key the row
 * will point at.
 */
export async function putSnapshot(
  productId: string,
  html: string,
  fetchedAt: number,
): Promise<string> {
  const key = snapshotKey(productId, fetchedAt);
  await env.MEDIA.put(key, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });
  return key;
}

/**
 * Record the snapshot, once the ladder has said which rung won.
 *
 * **Two writes that cannot be atomic**, and deliberately so — nothing spans
 * R2 and D1 (law 8c). The order is the one that fails safely: an object with
 * no row is invisible but recoverable, where a row pointing at an object
 * that was never written is a snapshot that lies about existing, and
 * `reextract` would break on it. `feed/photos.ts` makes the same trade for
 * the same reason.
 *
 * The residue is an orphaned object when D1 fails between the two. `MEDIA`
 * has no expiry, so it is permanent — the same cost D-27 already records for
 * entry photos, and it is storage rather than correctness.
 */
export async function recordSnapshot(
  database: Db,
  input: {
    productId: string;
    url: string;
    r2Key: string;
    rung: SnapshotRung;
    fetchedAt: number;
  },
): Promise<string> {
  const id = newUlid();
  await database.insert(productSnapshots).values({ id, ...input });
  return id;
}
