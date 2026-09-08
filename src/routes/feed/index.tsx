import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getSession } from "../../modules/auth/functions";
import type { FeedItem } from "../../modules/feed/feed";
import { followingFeedQuery, yourConditionsQuery } from "../../modules/feed/functions";
import type { ConsensusResult } from "../../modules/feed/consensus";
import { uiGroupLabels, uiGroups } from "../../modules/feed/groups";
import { redirectTo } from "../../modules/feed/redirect";
import { formatTemp } from "../../lib/temperature";
import { Bracketed, Layout, Mono, Skeleton } from "../../ui";

export const Route = createFileRoute("/feed/")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  loader: async () => ({ page: await followingFeedQuery({ data: { cursor: undefined } }) }),
  component: FeedPage,
});

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1609.34).toFixed(1)}mi`;
}

function FeedPage() {
  const { page } = Route.useLoaderData();
  const [tab, setTab] = useState<"following" | "conditions">("following");

  return (
    <Layout>
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
          <FollowingTab items={page.items} />
        ) : (
          <ConditionsTab />
        )}
      </div>
    </Layout>
  );
}

function FollowingTab({ items }: Readonly<{ items: FeedItem[] }>) {
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
                <Mono className="text-xs text-teal">{formatTemp(item.conditions.tempC, "f")}</Mono>
              ) : undefined}
            </div>
            <Mono className="text-xs text-night/60">{formatDistance(item.distanceM)}</Mono>
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

function ConditionsTab() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "no-location" }
    | { status: "ready"; result: ConsensusResult }
  >({ status: "loading" });

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "no-location" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void yourConditionsQuery({
          data: { lat: position.coords.latitude, lng: position.coords.longitude },
        }).then((result) => {
          setState(
            result ? { status: "ready", result } : { status: "no-location" },
          );
        });
      },
      () => {
        setState({ status: "no-location" });
      },
    );
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.status === "no-location") {
    return (
      <p className="py-12 text-center text-night/60">
        Enable location to see what other runners are wearing right now.
      </p>
    );
  }
  const { result } = state;
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
