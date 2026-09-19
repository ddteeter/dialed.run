import { RETRY_GENERIC } from "../../../lib/copy";
import { useState } from "react";

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

  async function loadAuthorizeUrl() {
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
          disabled={isBusy}
          onClick={() => {
            void loadAuthorizeUrl();
          }}
          className="rounded-pill bg-ink px-4 py-2 font-semibold text-ground disabled:opacity-50"
        >
          Connect Strava
        </button>
        {error === undefined ? undefined : (
          <p className="text-small font-semibold text-cold-text">{error}</p>
        )}
        {authorizeUrl === undefined ? undefined : (
          <a href={authorizeUrl} className="text-body text-muted underline">
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
          disabled={isBusy}
          onClick={() => {
            void loadAuthorizeUrl();
          }}
          className="rounded-pill bg-ink px-4 py-2 font-semibold text-ground disabled:opacity-50"
        >
          Reconnect Strava
        </button>
      ) : undefined}
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          void onDisconnect();
        }}
        className="rounded-pill border border-hairline px-4 py-2 font-semibold text-ink disabled:opacity-50"
      >
        Disconnect
      </button>
      {error === undefined ? undefined : (
        <p className="text-small font-semibold text-cold-text">{error}</p>
      )}
    </div>
  );
}
