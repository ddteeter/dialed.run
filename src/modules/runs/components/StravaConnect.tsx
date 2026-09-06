import { useState } from "react";

import {
  disconnectStravaFn,
  getStravaAuthorizeUrlFn,
} from "../functions";

export interface StravaConnectProps {
  configured: boolean;
  status: "ok" | "broken" | undefined;
}

/**
Connect/disconnect (102 §6). "Connect" leaves the app for Strava's own
consent screen — a plain external `<a>`, not a typed Link (the "no
string-literal app URLs" lint rule only fires on root-relative literals;
this is a full external URL fetched from the server at click time).
*/
export function StravaConnect({ configured, status }: Readonly<StravaConnectProps>) {
  const [authorizeUrl, setAuthorizeUrl] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function loadAuthorizeUrl() {
    setError(undefined);
    setIsBusy(true);
    try {
      const url = await getStravaAuthorizeUrlFn();
      if (url === undefined) {
        setError("Strava isn't configured yet.");
        return;
      }
      setAuthorizeUrl(url);
      globalThis.location.assign(url);
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setIsBusy(false);
    }
  }

  async function disconnect() {
    setError(undefined);
    setIsBusy(true);
    try {
      await disconnectStravaFn();
      globalThis.location.reload();
    } catch {
      setError("That didn't work. Try again.");
      setIsBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-night/50">
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
          className="rounded-md bg-night px-4 py-2 font-semibold text-chalk disabled:opacity-50"
        >
          Connect Strava
        </button>
        {error === undefined ? undefined : (
          <p className="text-sm font-semibold text-pink">{error}</p>
        )}
        {authorizeUrl === undefined ? undefined : (
          <a href={authorizeUrl} className="text-sm text-night/50 underline">
            Continue to Strava
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold text-night">
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
          className="rounded-md bg-night px-4 py-2 font-semibold text-chalk disabled:opacity-50"
        >
          Reconnect Strava
        </button>
      ) : undefined}
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          void disconnect();
        }}
        className="rounded-md border border-night/20 px-4 py-2 font-semibold text-night disabled:opacity-50"
      >
        Disconnect
      </button>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
    </div>
  );
}
