/**
 * What the bell shows (round 22, item 13): a **number** when there are
 * runs waiting for a verdict, because each one is a thing to do, and
 * otherwise a **dot** for anything unread.
 *
 * Its own file for `bell-cap.ts`'s reason: the bell is in the client
 * bundle, so it cannot import the service that computes this.
 */
export interface BellState {
  unreadCount: number;
  verdictsWaiting: number;
}
