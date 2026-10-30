import type { PurgeTags } from "../src/lib/cache-tags";

/**
 * A purge that records each call's tags (design 161), for the tests that
 * assert what a write purges from the edge.
 */
export function purgeSpy(): { purge: PurgeTags; calls: string[][] } {
  const calls: string[][] = [];
  return {
    purge: (tags) => {
      calls.push([...tags]);
    },
    calls,
  };
}

/**
A purge for a test about something else: it names nothing anywhere.
*/
export const noPurge: PurgeTags = () => {
  // Nothing to purge: the test is about the write.
};
