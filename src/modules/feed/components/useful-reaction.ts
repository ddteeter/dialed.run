import { useState } from "react";

import { useControlAction } from "../../../ui";

/**
 * The server's own answer to a press: the new reacted state, from which the
 * count moves — Useful is not optimistic (round 23, item 9).
 */
export type ToggleUsefulFn = (input: {
  data: { entryId: string };
}) => Promise<{ useful: boolean }>;

export interface UsefulReactionInput {
  entryId: string;
  usefulCount: number;
  viewerHasReacted: boolean;
  toggleUseful: ToggleUsefulFn;
}

/**
 * Useful's optimistic-free count + reacted state, shared by D's own button
 * and the E1 card control (round 22 draws it in both places): press, wait
 * for the server behind `[ Noting ]`, and move the count on success only.
 *
 * The state still true when the press fails is the one it tried to leave:
 * §4a names "Not marked" for Useful, and taking one back that fails is
 * still marked (design-deltas item 27).
 */
export function useUsefulReaction({
  entryId,
  usefulCount,
  viewerHasReacted,
  toggleUseful,
}: UsefulReactionInput) {
  const [useful, setUseful] = useState({
    count: usefulCount,
    reacted: viewerHasReacted,
  });
  const markUseful = useControlAction({
    action: async () => {
      const result = await toggleUseful({ data: { entryId } });
      setUseful((previous) => ({
        count: result.useful ? previous.count + 1 : previous.count - 1,
        reacted: result.useful,
      }));
    },
    kicker: useful.reacted ? "Still marked" : "Not marked",
  });
  return { useful, markUseful };
}
