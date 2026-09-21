import { RETRY_GENERIC } from "../../../lib/copy";
import { useState } from "react";

import { inFlight, PendingLabel } from "../../../ui";

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
  getAuthorizeUrl: () => Promise<string | undefined>;
  disconnect: () => Promise<unknown>;
}

/**
Connect/disconnect (102 §6). "Connect" leaves the app for Strava's own
consent screen — a plain external `<a>`, not a typed Link (the "no
string-literal app URLs" lint rule only fires on root-relative literals;
this is a full external URL fetched from the server at click time).
*/
export function StravaConnect({
  configured,
  status,
  getAuthorizeUrl,
  disconnect,
}: Readonly<StravaConnectProps>) {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The guard the `disabled` attribute used to be, shared by both
  // handlers: `aria-disabled` keeps these three buttons focusable and
  // announcing (rule 07), so a second press still arrives — and all three
  // share one `isBusy`, which means a press on any of them mid-flight
  // would start a second round trip against the same connection.
  async function loadAuthorizeUrl() {
    if (isBusy) return;
    setError(undefined);
    setIsBusy(true);
    try {
      const url = await getAuthorizeUrl();
      if (url === undefined) {
        setError("Strava isn't configured yet.");
        return;
      }
      setAuthorizeUrl(url);
      globalThis.location.assign(url);
    } catch {
      setError(RETRY_GENERIC);
    } finally {
      setIsBusy(false);
    }
  }

  async function onDisconnect() {
    if (isBusy) return;
    setError(undefined);
    setIsBusy(true);
    try {
      await disconnect();
      globalThis.location.reload();
    } catch {
      setError(RETRY_GENERIC);
      setIsBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-small text-muted">
        Strava reminders aren&rsquo;t set up for this deployment yet.
      </p>
    );
  }

  if (status === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          {...inFlight(isBusy)}
          onClick={() => {
            void loadAuthorizeUrl();
          }}
          className="target rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
        >
          <PendingLabel
            label="Connect Strava"
            pendingLabel="Connecting"
            pending={isBusy}
          />
        </button>
        {error === undefined ? undefined : (
          <p className="text-small font-semibold text-cold-text">{error}</p>
        )}
        {authorizeUrl === undefined ? undefined : (
          <a
            href={authorizeUrl}
            className="target inline-flex items-center text-body text-muted underline"
          >
            Continue to Strava
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold text-ink">
        {status === "ok"
          ? "Strava is connected. We'll remind you to log your kit after a run."
          : "Strava needs to be reconnected."}
      </p>
      {status === "broken" ? (
        <button
          type="button"
          {...inFlight(isBusy)}
          onClick={() => {
            void loadAuthorizeUrl();
          }}
          className="target rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
        >
          <PendingLabel
            label="Reconnect Strava"
            pendingLabel="Reconnecting"
            pending={isBusy}
          />
        </button>
      ) : undefined}
      <button
        type="button"
        {...inFlight(isBusy)}
        onClick={() => {
          void onDisconnect();
        }}
        className="target rounded-pill border border-hairline px-4 py-2 font-semibold text-ink"
      >
        <PendingLabel
          label="Disconnect"
          pendingLabel="Disconnecting"
          pending={isBusy}
        />
      </button>
      {error === undefined ? undefined : (
        <p className="text-small font-semibold text-cold-text">{error}</p>
      )}
    </div>
  );
}
