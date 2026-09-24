import type { JSX, ReactNode } from "react";
import { useState } from "react";

import {
  ControlFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  useControlAction,
} from "../../../ui";
import type { ControlAction } from "../../../ui";

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
  status: "ok" | "broken" | undefined;
  /**
  How many runs the runner has — what T3b promises is kept.
  */
  runCount: number;
  getAuthorizeUrl: () => Promise<string | undefined>;
  disconnect: () => Promise<unknown>;
}

/**
 * Leaves for Strava's own consent screen, with a URL fetched at click
 * time — a plain navigation to an external address, not a typed Link.
 * An answer with no URL is a failure like any other: there is nowhere to
 * go, and the band says so.
 */
export async function leaveForStrava(
  getAuthorizeUrl: StravaConnectProps["getAuthorizeUrl"],
): Promise<void> {
  const url = await getAuthorizeUrl();
  if (url === undefined) throw new Error("Strava gave no authorize URL.");
  globalThis.location.assign(url);
}

const PRIMARY =
  "target rounded-field border-none bg-ink px-4 text-body font-bold text-ground";
const SECONDARY =
  "target rounded-field border border-ink bg-transparent px-4 text-body font-semibold text-ink";

/**
 * The connect control and its failure band — identical whether Strava has
 * never been connected or needs reconnecting after a break; only the
 * button's words change between the two, so those are the only prop.
 */
function ConnectAction({
  connect,
  label,
  pendingLabel,
}: Readonly<{
  connect: ControlAction<[]>;
  label: string;
  pendingLabel: string;
}>): JSX.Element {
  return (
    <>
      <button
        type="button"
        {...inFlight(connect.pending)}
        onClick={() => {
          void connect.run();
        }}
        className={PRIMARY}
      >
        <PendingLabel
          label={label}
          pendingLabel={pendingLabel}
          pending={connect.pending}
        />
      </button>
      <ControlFailureBand
        failure={connect.failure}
        onRetry={connect.retry}
        retryRef={connect.retryRef}
      />
    </>
  );
}

/**
 * Connect and disconnect (Remaining Screens T1, T3; round 22, item 23).
 *
 * **Not configured, nothing is drawn** — *"the row and button are absent
 * — never a dead control."* **Disconnect confirms**, as T3b draws it: what
 * is kept, what stops, and "Keep it" beside the verb. **A failure is a
 * control's** (round 23, item 9): the band under the control names what
 * is still true — `NOT CONNECTED`, `STILL CONNECTED` — and nothing snaps
 * back, because nothing moved before the server answered.
 */
export function StravaConnect({
  configured,
  status,
  runCount,
  getAuthorizeUrl,
  disconnect,
}: Readonly<StravaConnectProps>): JSX.Element | undefined {
  const [isConfirming, setIsConfirming] = useState(false);
  const connect = useControlAction({
    kicker: "Not connected",
    action: async () => leaveForStrava(getAuthorizeUrl),
  });
  const cut = useControlAction({
    kicker: "Still connected",
    action: disconnect,
    onSuccess: () => {
      globalThis.location.reload();
    },
  });

  if (!configured) return undefined;

  if (status === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <FormStatus>{connect.status}</FormStatus>
        <ConnectAction
          connect={connect}
          label="Connect Strava"
          pendingLabel="Connecting"
        />
        <p className="m-0 text-small text-muted">
          You&rsquo;ll approve this on Strava&rsquo;s own screen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormStatus>{connect.status || cut.status}</FormStatus>
      <p className="m-0 font-semibold text-ink">
        {status === "ok"
          ? "Strava is connected. We'll remind you to log your kit after a run."
          : "Strava needs to be reconnected."}
      </p>
      {status === "broken" ? (
        <ConnectAction
          connect={connect}
          label="Reconnect Strava"
          pendingLabel="Reconnecting"
        />
      ) : undefined}
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
            <KeptOrStops word="Kept">
              Your closet and everything it has learned
            </KeptOrStops>
            <KeptOrStops word="Stops">
              New runs arriving on their own — log by hand instead
            </KeptOrStops>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              {...inFlight(cut.pending)}
              onClick={() => {
                void cut.run();
              }}
              className={PRIMARY}
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
