/**
 * A request that throws out of the Worker is reported once per kind of
 * error per window in an isolate, and every report of one kind is one
 * Sentry issue, so one request shape repeated cannot send one event per
 * request.
 */

/**
How long a kind of error stays reported before it is sent again.
*/
export const REPEAT_WINDOW_MS = 60_000;

/**
 * The most kinds remembered at once. Past it the oldest is forgotten, so
 * the memory an isolate keeps for this is bounded whatever is thrown.
 */
export const MAX_REMEMBERED_KINDS = 64;

/**
 * What groups an error: its name and its message, never its stack or its
 * own properties.
 */
export function errorKind(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : typeof error;
}

/**
 * Whether a kind of error should be sent now: the first time it is seen,
 * and again once the window since it was last sent has passed.
 */
export type RepeatGate = (kind: string, now: number) => boolean;

export function repeatGate(
  windowMs: number = REPEAT_WINDOW_MS,
  maxKinds: number = MAX_REMEMBERED_KINDS,
): RepeatGate {
  const sentAt = new Map<string, number>();
  return (kind, now) => {
    const last = sentAt.get(kind);
    const isDue = last === undefined || now - last >= windowMs;
    if (!isDue) return false;
    sentAt.delete(kind);
    sentAt.set(kind, now);
    // Oldest first, until no more than `maxKinds` are left.
    for (const oldest of sentAt.keys()) {
      if (sentAt.size <= maxKinds) break;
      sentAt.delete(oldest);
    }
    return true;
  };
}
