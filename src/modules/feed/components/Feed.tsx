import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { formatDistance, formatTempRange } from "../../../lib/measures";
import type { Units } from "../../../lib/contracts";
import { Bracketed, Mono, Skeleton } from "../../../ui";
import type { ConsensusResult } from "../consensus";
import type { FeedItem } from "../feed";
import { uiGroupLabels, uiGroups } from "../groups";

/**
 * The feed (screen E1/E2-lite), and the two tabs it switches between.
 *
 * "Your conditions" is loaded on demand rather than in the route's loader:
 * it needs the browser's location, which the server rendering the page
 * does not have, and asking for it before the tab is opened would prompt
 * every visitor for a permission most of them never use.
 */
export function Feed({
  items,
  conditionsFor,
  units,
}: Readonly<{
  items: FeedItem[];
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  conditionsFor: (input: {
    data: { lat: number; lng: number };
  }) => Promise<ConsensusResult | undefined>;
}>) {
  const [tab, setTab] = useState<"following" | "conditions">("following");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl uppercase leading-none">Feed</h1>
          <Link to="/feed/search" className="text-sm font-semibold text-pink">
            Find runners
          </Link>
        </div>
        <div className="flex gap-1 border-b border-night/15">
          {(["following", "conditions"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
              }}
              className={
                tab === value
                  ? "border-b-2 border-pink px-3 py-2 font-semibold"
                  : "px-3 py-2 text-night/50"
              }
            >
              {value === "following" ? "Following" : "Your conditions"}
            </button>
          ))}
        </div>
        {tab === "following" ? (
          <FollowingTab items={items} units={units} />
        ) : (
          <ConditionsTab conditionsFor={conditionsFor} />
        )}
    </div>
  );
}

function FollowingTab({
  items,
  units,
}: Readonly<{ items: FeedItem[]; units: Units }>) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-12 text-center text-night/60">
        <p>Nobody you follow has posted yet.</p>
        <Link to="/feed/search" className="font-semibold text-pink">
          Search for runners to follow
        </Link>
      </div>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {items.map((item) => (
        <li key={item.entryId} className="rounded-xl border border-night/10 p-4">
          <Link
            to="/feed/entry/$entryId"
            params={{ entryId: item.entryId }}
            className="flex flex-col gap-2 text-night no-underline"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{item.authorDisplayName ?? "A runner"}</span>
              {item.conditions ? (
                <Mono className="text-xs text-teal">{formatTempRange(
                    item.conditions.span.minTempC,
                    item.conditions.span.maxTempC,
                    units.temp,
                  )}</Mono>
              ) : undefined}
            </div>
            <Mono className="text-xs text-night/60">{formatDistance(item.distanceM, units.distance)}</Mono>
            {item.caption ? <p className="m-0 text-sm">{item.caption}</p> : undefined}
            <Mono className="text-xs text-night/40">
              useful [{String(item.usefulCount)}]
            </Mono>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ConditionsTab({
  conditionsFor,
}: Readonly<{
  conditionsFor: (input: {
    data: { lat: number; lng: number };
  }) => Promise<ConsensusResult | undefined>;
}>) {
  // Three states, and the union carries them as values rather than as a
  // tagged object: "waiting", "nothing to show" and an answer. An object
  // wrapper would give every one of them a discriminant string that
  // nothing reads, which is a label the type checker sees and no test
  // can.
  const [state, setState] = useState<ConsensusResult | "loading" | undefined>(
    "loading",
  );

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void conditionsFor({
          data: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        }).then(setState);
      },
      () => {
        setState(undefined);
      },
    );
  }, [conditionsFor]);

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state === undefined) {
    return (
      <p className="py-12 text-center text-night/60">
        Enable location to see what other runners are wearing right now.
      </p>
    );
  }
  const result = state;
  if (result.total === 0) {
    return (
      <p className="py-12 text-center text-night/60">
        Nobody near you has logged these conditions yet. You&rsquo;ll be the first.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Bracketed className="text-sm">
        {String(result.total)} {result.total === 1 ? "runner" : "runners"} logged
        {result.widened ? " (widened window)" : ""}
      </Bracketed>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {uiGroups
          .filter((group) => result.groups[group] !== undefined)
          .map((group) => (
            <li key={group} className="flex items-center justify-between">
              <span>{uiGroupLabels[group]}</span>
              <Mono className="text-teal">
                {String(result.groups[group])}/{String(result.total)}
              </Mono>
            </li>
          ))}
      </ul>
    </div>
  );
}
