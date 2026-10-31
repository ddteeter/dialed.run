import { useRouter } from "@tanstack/react-router";
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
 * deltas item 95), composed from the confirm the deletes use.
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
  const router = useRouter();
  if (bursts.length === 0) return undefined;
  return (
    <PhotoSection part="release-holds" title="Held in the last day">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {bursts.map(({ cause, waiting }) => (
          <li key={cause} className="flex flex-col">
            <Mono step="xs">{`${CAUSE_LABEL[cause]} · ${String(waiting)} waiting`}</Mono>
            <ConfirmLink
              label={`Approve all ${String(waiting)}`}
              heading={`Approve ${String(waiting)} ${CAUSE_NOUN[cause]}?`}
              body="Each one is approved as if you'd pressed Approve on it: it goes back where an Approve puts it, and anyone an Approve tells is told. Use this when a bug held them, not to skip looking."
              verb="Approve all"
              pendingVerb="Approving"
              kicker="Not all approved"
              state={`confirm-release-${cause}`}
              act={async () => {
                await releaseAll(release, cause, since);
                await router.invalidate();
              }}
            />
          </li>
        ))}
      </ul>
    </PhotoSection>
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
 * call releases a bounded batch and says whether more wait.
 */
async function releaseAll(
  release: ReleaseHoldsFn,
  cause: HoldCause,
  since: number,
): Promise<void> {
  let outcome = await release({ data: { cause, since } });
  while (outcome.hasMore) {
    outcome = await release({ data: { cause, since } });
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
