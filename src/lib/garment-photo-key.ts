/**
 * The garment's own prefix in R2. Every version of every photo the garment
 * has ever had sits under it, so it is the unit a cleanup works on.
 *
 * In lib because two modules build it and neither may import the other:
 * closet writes under it, and ops drains the outbox that clears it (closet
 * already imports ops, so the reverse would be a cycle).
 *
 * Built from the signed-in runner's own id, never from a stored row, so a
 * cleanup can only ever reach that runner's objects.
 */
export function photoKeyFor(userId: string, itemId: string): string {
  return `items/${userId}/${itemId}`;
}
