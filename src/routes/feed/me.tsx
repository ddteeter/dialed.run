import { createFileRoute, Link } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { ownProfileQuery } from "../../modules/feed/functions";
import { redirectTo } from "../../modules/feed/redirect";
import { Bracketed, Layout, Mono } from "../../ui";

/**
 * O1 writes thermal_level on a -2..+2 scale (docs/contracts.md);
 * presentational copy only, not part of the shared contract.
 */
const THERMAL_BLURBS: Record<number, string> = {
  "-2": "Runs hot — sweating in a t-shirt at 40°",
  "-1": "Runs warm",
  "0": "Runs average",
  "1": "Runs cold",
  "2": "Runs cold — always freezing",
};

export const Route = createFileRoute("/feed/me")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  loader: async () => ({ profile: await ownProfileQuery() }),
  component: OwnProfilePage,
});

function OwnProfilePage() {
  const { profile } = Route.useLoaderData();

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl uppercase leading-none">
            {profile.displayName ?? "You"}
          </h1>
          {profile.cityLabel ? (
            <p className="m-0 text-sm text-night/60">{profile.cityLabel}</p>
          ) : undefined}
          {profile.thermalLevel === undefined ? undefined : (
            <p className="m-0 text-sm text-night/60">
              {THERMAL_BLURBS[profile.thermalLevel] ?? "Runs average"}
            </p>
          )}
        </div>

        <div className="flex gap-6">
          <Mono className="text-sm">
            {String(profile.followerCount)} followers
          </Mono>
          <Mono className="text-sm">
            {String(profile.followingCount)} following
          </Mono>
          <Mono className="text-sm">{String(profile.entryCount)} entries</Mono>
        </div>

        {profile.coverage.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase">
              Temperature coverage
            </h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {profile.coverage.map((band) => (
                <li key={band.bandFloorC} className="flex items-center gap-2 text-sm">
                  <Bracketed className="w-24 shrink-0 text-night/40">
                    {band.label}
                  </Bracketed>
                  <span className="text-pink">{"●".repeat(band.cold)}</span>
                  <span className="text-teal">{"●".repeat(band.dialed)}</span>
                  <span className="text-night/30">{"●".repeat(band.warm)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : undefined}

        {profile.mostWornItems.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase">Most worn</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {profile.mostWornItems.map((item) => (
                <li key={item.itemId} className="flex items-center justify-between text-sm">
                  <span>{item.name}</span>
                  <Mono className="text-night/40">[{String(item.wearCount)}]</Mono>
                </li>
              ))}
            </ul>
          </div>
        ) : undefined}

        {profile.recentEntries.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase">Recent entries</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {profile.recentEntries.map((entry) => (
                <li key={entry.entryId}>
                  <Link
                    to="/feed/entry/$entryId"
                    params={{ entryId: entry.entryId }}
                    className="text-sm font-semibold text-night no-underline"
                  >
                    {entry.verdict === null ? "No verdict yet" : "Entry"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : undefined}
      </div>
    </Layout>
  );
}
