import type { JSX, ReactNode } from "react";
import { useEffect, useState } from "react";

import { clockLabel, dayLabel, deviceTimeZone } from "../../../lib/dates";
import {
  ControlFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  StravaButton,
  useControlAction,
} from "../../../ui";

/**
 * The server functions, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires them and this renders. Each prop's shape is the
 * server function's own, so the route passes them with no wrapper.
 */
export interface StravaConnectProps {
  configured: boolean;
  connected: boolean;
  /**
   * When Strava last told us a run landed (epoch seconds) — T3a's "LAST
   * RUN SEEN". Undefined until the first one.
   */
  lastRunSeenAt: number | undefined;
  /**
  How many runs the runner has — what T3b promises is kept.
  */
  runCount: number;
  disconnect: () => Promise<unknown>;
}

const SECONDARY =
  "target rounded-field border border-ink bg-transparent px-4 text-body font-semibold text-ink";

/**
 * The time a run last landed on Strava, in the runner's own zone — which
 * only the device knows, so it is drawn after mount and never in the
 * server's first paint (see `lib/dates.ts`).
 *
 * The effect has no dependency list on purpose: it sets the same value
 * after every render, which React ignores, and leaves no array for a
 * mutant to replace. A device that names no zone it would accept reads
 * as UTC, which `lib/dates` already does for an undefined zone.
 */
function LastRunSeen({ at }: Readonly<{ at: number }>): JSX.Element {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  });
  if (!isMounted) return <></>;
  const zone = deviceTimeZone();
  return (
    <>{` · Last run seen ${dayLabel(at, zone)}, ${clockLabel(at, zone)}`}</>
  );
}

/**
 * Connect and disconnect (Remaining Screens T1, T3; round 22, item 23;
 * round 25; round 26, item 21).
 *
 * **Not configured, nothing is drawn** — *"the row and button are absent
 * — never a dead control."* **Disconnect confirms**, as T3b draws it: what
 * is kept, what stops, and "Keep it" beside the verb. **A failure is a
 * control's** (round 23, item 9): the band under the control names what
 * is still true — `STILL CONNECTED` — and nothing snaps back, because
 * nothing moved before the server answered.
 *
 * There is no "reconnect" state any more (task 127). Nothing refreshes a
 * token, so nothing can find a grant broken; a runner who revokes us on
 * Strava's side is disconnected outright, and sees the connect button.
 */
export function StravaConnect({
  configured,
  connected,
  lastRunSeenAt,
  runCount,
  disconnect,
}: Readonly<StravaConnectProps>): JSX.Element | undefined {
  const [isConfirming, setIsConfirming] = useState(false);
  const cut = useControlAction({
    kicker: "Still connected",
    action: disconnect,
    onSuccess: () => {
      globalThis.location.reload();
    },
  });

  if (!configured) return undefined;

  if (!connected) {
    return (
      <div className="flex flex-col gap-3">
        <StravaButton />
        <p className="m-0 text-small text-muted">
          You&rsquo;ll approve this on Strava&rsquo;s own screen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormStatus>{cut.status}</FormStatus>
      {/* Round 25's T3a status line. */}
      <Mono step="sm" className="text-dialed-text">
        Connected
        {lastRunSeenAt === undefined ? undefined : (
          <LastRunSeen at={lastRunSeenAt} />
        )}
      </Mono>
      {isConfirming ? (
        <div
          data-slot="disconnect-confirm"
          className="flex flex-col gap-3 border border-ink p-4"
        >
          <h2 className="m-0 font-display text-lead">Disconnect Strava?</h2>
          <dl className="m-0 flex flex-col gap-2">
            <KeptOrStops word="Kept">
              All {runCount} runs, their outfits and verdicts
            </KeptOrStops>
            {/* Round 25: nothing ever arrived on its own — connecting turns
                on a reminder, so disconnecting turns off the reminder, and
                adding runs by file is untouched. */}
            <KeptOrStops word="Kept">
              Adding runs: upload any run&rsquo;s file here, as always
            </KeptOrStops>
            <KeptOrStops word="Stops">The reminder after each run</KeptOrStops>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              {...inFlight(cut.pending)}
              onClick={() => {
                void cut.run();
              }}
              className="target rounded-field border-none bg-ink px-4 text-body font-bold text-ground"
            >
              <PendingLabel
                label="Disconnect"
                pendingLabel="Disconnecting"
                pending={cut.pending}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsConfirming(false);
              }}
              className={SECONDARY}
            >
              Keep it
            </button>
          </div>
          <ControlFailureBand
            failure={cut.failure}
            onRetry={cut.retry}
            retryRef={cut.retryRef}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsConfirming(true);
          }}
          className={SECONDARY}
        >
          Disconnect
        </button>
      )}
    </div>
  );
}

/**
 * One line of T3b's table — "same grammar as read/never": a mono word, in
 * the dialed colour for what stays and the cold one for what stops, then
 * the sentence. *"No scare copy, no red."*
 */
function KeptOrStops({
  word,
  children,
}: Readonly<{ word: "Kept" | "Stops"; children: ReactNode }>): JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <dt>
        <Mono
          step="sm"
          className={word === "Kept" ? "text-dialed-text" : "text-cold-text"}
        >
          {word}
        </Mono>
      </dt>
      <dd className="m-0 text-body">{children}</dd>
    </div>
  );
}
