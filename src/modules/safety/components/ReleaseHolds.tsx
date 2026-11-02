import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import type { HoldCause } from "../../../lib/contracts/hold-causes";
import { ConfirmLink, Mono } from "../../../ui";
import type { ReleaseOutcome, WaitingHolds } from "../release";
import { PhotoSection } from "./OtherPhotos";

/**
 * Releasing a burst of holds, at the top of Review (design 164): one line
 * per cause with holds still waiting from the last day, each with an
 * Approve-them-all behind a confirm. The breakers bound how many a bug can
 * hold an hour; this is the undo for the hours before anyone looked.
 *
 * Each release is many Approves, each told as one is, so the confirm says
 * so and says when to use it. It presses the server function until
 * nothing of that cause and day is left. An undesigned surface (design
 * deltas item 97), composed from the confirm the deletes use.
 */
export function ReleaseHolds({
  bursts,
  since,
  release,
}: Readonly<{
  bursts: readonly WaitingHolds[];
  /**
  Epoch seconds the counted day starts: what each release is asked about.
  */
  since: number;
  release: ReleaseHoldsFn;
}>): JSX.Element | undefined {
  if (bursts.length === 0) return undefined;
  return (
    <PhotoSection part="release-holds" title="Held in the last day">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {bursts.map((burst) => (
          <ReleaseRow
            key={burst.cause}
            burst={burst}
            since={since}
            release={release}
          />
        ))}
      </ul>
    </PhotoSection>
  );
}

/**
 * One cause's line and its Approve-them-all. While it runs, the button
 * counts what is done (owner, 2026-11-02): a burst is released a batch a
 * press, and the operator waits on it.
 */
function ReleaseRow({
  burst,
  since,
  release,
}: Readonly<{
  burst: WaitingHolds;
  since: number;
  release: ReleaseHoldsFn;
}>): JSX.Element {
  const { cause, waiting } = burst;
  const router = useRouter();
  const [approved, setApproved] = useState(0);
  return (
    <li className="flex flex-col">
      <Mono step="xs">{`${CAUSE_LABEL[cause]} · ${String(waiting)} waiting`}</Mono>
      <ConfirmLink
        label={`Approve all ${String(waiting)}`}
        heading={`Approve ${String(waiting)} ${CAUSE_NOUN[cause]}?`}
        body="Each one is approved as if you'd pressed Approve on it: it goes back where an Approve puts it, and anyone an Approve tells is told. Use this when a bug held them, not to skip looking."
        verb="Approve all"
        pendingVerb={
          approved === 0
            ? "Approving"
            : `Approved ${String(approved)} of ${String(waiting)}`
        }
        kicker="Not all approved"
        state={`confirm-release-${cause}`}
        act={async () => {
          await releaseAll(release, cause, since, setApproved);
          await router.invalidate();
        }}
      />
    </li>
  );
}

/**
The release server function's own shape, handed down from the route.
*/
export type ReleaseHoldsFn = (input: {
  data: { cause: HoldCause; since: number };
}) => Promise<ReleaseOutcome>;

/**
 * Presses `release` until nothing of `cause` since `since` is left: each
 * call releases a bounded batch and says whether more wait. `counted` hears
 * the running total after each.
 */
async function releaseAll(
  release: ReleaseHoldsFn,
  cause: HoldCause,
  since: number,
  counted: (total: number) => void,
): Promise<void> {
  let total = 0;
  let hasMore = true;
  while (hasMore) {
    const outcome = await release({ data: { cause, since } });
    total += outcome.released;
    counted(total);
    hasMore = outcome.hasMore;
  }
}

const CAUSE_LABEL: Readonly<Record<HoldCause, string>> = {
  reports: "Reports",
  classifier: "Screener",
  fingerprint: "Fingerprint matches",
};

const CAUSE_NOUN: Readonly<Record<HoldCause, string>> = {
  reports: "reported items",
  classifier: "screener holds",
  fingerprint: "fingerprint holds",
};
