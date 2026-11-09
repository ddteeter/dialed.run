/**
 * The consensus reads, each after `syncRunConditions`: the seeds in
 * `./helpers` write past the copy's writers, so a test of what the
 * consensus answers reads it as the real write paths would have left it.
 * The scaling tests sync outside what they count instead.
 */
import * as compact from "../../src/modules/feed/compact-conditions";
import * as consensus from "../../src/modules/feed/consensus";
import { syncRunConditions } from "./helpers";

/**
`read`, with the copy brought up to date first.
*/
function synced<A extends unknown[], R>(
  read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    await syncRunConditions();
    return read(...args);
  };
}

export const matchTally = synced(consensus.matchTally);
export const yourConditionsConsensus = synced(
  consensus.yourConditionsConsensus,
);
export const consensusAt = synced(consensus.consensusAt);
export const feedConditions = synced(compact.feedConditions);
