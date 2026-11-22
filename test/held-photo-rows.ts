import { drizzle } from "drizzle-orm/d1";

import { reviewQueue, wardrobeItems } from "../src/db/schema-core";
import { env } from "../src/env";
import { newUlid } from "../src/lib/ids";

type QueueRow = typeof reviewQueue.$inferInsert;

/**
 * `n` garment photos of the runner's in Review, each its own garment and
 * its own row: the classifier's pending holds unless `row` says otherwise.
 */
export async function heldGarmentPhotos(
  userId: string,
  n: number,
  row: Partial<Pick<QueueRow, "source" | "status">> = {},
): Promise<void> {
  const core = drizzle(env.DIALED_CORE);
  for (let index = 0; index < n; index += 1) {
    const itemId = newUlid();
    await core.insert(wardrobeItems).values({
      id: itemId,
      userId,
      category: "top",
      type: "tee",
      name: "Held tee",
      photoKey: `items/${userId}/${itemId}/original`,
      origin: "manual",
      createdAt: 1,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "garment",
      subjectId: itemId,
      source: row.source ?? "classifier",
      status: row.status ?? "pending",
      createdAt: 1,
      openedAt: 1,
    });
  }
}
