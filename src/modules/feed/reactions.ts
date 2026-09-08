/**
 * "Useful" reactions (D-11). COUNT(*) on read, no denormalized counter —
 * the packet is explicit that the count query is cheap and correct at
 * MVP scale.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, reactions } from "../../db/schema-core";
import { env } from "../../env";

function db() {
  return drizzle(env.DIALED_CORE);
}

class NotVisibleError extends Error {
  constructor() {
    super("entry is not visible to this viewer");
  }
}

async function assertVisible(entryId: string, viewerId: string): Promise<void> {
  const [entry] = await db()
    .select({ userId: outfitEntries.userId, isPublic: outfitEntries.isPublic })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!entry) throw new NotVisibleError();
  if (!entry.isPublic && entry.userId !== viewerId) throw new NotVisibleError();
}

/**
 * Toggles the viewer's "useful" reaction; returns the resulting state.
 */
export async function toggleUsefulReaction(
  entryId: string,
  userId: string,
): Promise<{ useful: boolean }> {
  await assertVisible(entryId, userId);
  const isAlready = await hasReacted(entryId, userId);
  if (isAlready) {
    await db()
      .delete(reactions)
      .where(and(eq(reactions.entryId, entryId), eq(reactions.userId, userId)));
    return { useful: false };
  }
  await db()
    .insert(reactions)
    .values({
      entryId,
      userId,
      kind: "useful",
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
  return { useful: true };
}

export async function hasReacted(
  entryId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ userId: reactions.userId })
    .from(reactions)
    .where(and(eq(reactions.entryId, entryId), eq(reactions.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function usefulCount(entryId: string): Promise<number> {
  const rows = await db()
    .select({ userId: reactions.userId })
    .from(reactions)
    .where(eq(reactions.entryId, entryId));
  return rows.length;
}
