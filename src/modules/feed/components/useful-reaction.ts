import { useState } from "react";

import { useControlAction } from "../../../ui";

/**
 * Asks the server for the viewer's Useful as a state, and answers with the
 * state the server now holds — its own count and mark, never a ±1 on the
 * client's guess (law 8b).
 */
export type SetUsefulFn = (input: {
  data: { entryId: string; useful: boolean };
}) => Promise<{ useful: boolean; count: number }>;

export interface UsefulReactionInput {
  entryId: string;
  usefulCount: number;
  viewerHasReacted: boolean;
  setUseful: SetUsefulFn;
}

/**
 * Useful's count and mark, shared by D's button and the E1 card (round 22
 * draws it in both places): press, wait for the server behind `[ Noting ]`,
 * then show what the server says.
 *
 * **The press carries the state it wants**, fixed when pressed, so the
 * band's Try again repeats that same request: if the first one landed and
 * only its answer was lost, the retry changes nothing — where a toggle
 * would have taken the mark back.
 *
 * The state still true when the press fails is the one it tried to leave:
 * §4a names "Not marked" for Useful, and taking one back that fails is
 * still marked (design-deltas item 27).
 */
export function useUsefulReaction({
  entryId,
  usefulCount,
  viewerHasReacted,
  setUseful,
}: UsefulReactionInput) {
  const [useful, setState] = useState({
    count: usefulCount,
    reacted: viewerHasReacted,
  });
  const markUseful = useControlAction({
    action: async (isUseful: boolean) => {
      const result = await setUseful({ data: { entryId, useful: isUseful } });
      setState({ count: result.count, reacted: result.useful });
    },
    kicker: useful.reacted ? "Still marked" : "Not marked",
  });
  return { useful, markUseful };
}
