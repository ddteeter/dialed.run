import { Link } from "@tanstack/react-router";

import { Bracketed, Mono, VerdictMark } from "../../../ui";
import type { VerdictKind } from "../../../ui";
import { bandVerdict } from "../coverage";
import type { ownProfile } from "../profiles";
import { ListSection } from "./ListSection";

type Profile = Awaited<ReturnType<typeof ownProfile>>;

/**
 * O1 writes `thermal_level` on a -2..+2 scale (docs/contracts.md). These
 * are presentational only and deliberately not part of the shared
 * contract — the number is the fact, this is how it reads.
 */
/**
 * How a band reads in words — design §AB3's own copy.
 *
 * **Three redundant channels: slot position, hue, and this.** The row this
 * replaces had one — hue, on three identical dot runs, with warm at 30%
 * ink. A three-way distinction carried by colour alone is the failure
 * §Forms & failure rules out for errors, and the 30% made it a contrast
 * failure as well. `text-night/30` is retired outright (§AB rule 04):
 * opacity never encodes meaning.
 *
 * Under- and over-dressed rather than "cold" and "warm": the band already
 * says the temperature, so the useful fact is what the runner did about it.
 */
const VERDICT_WORD: Readonly<Record<VerdictKind, string>> = {
  cold: "Under-dressed",
  dialed: "Dialed",
  warm: "Over-dressed",
};

const THERMAL_BLURBS: Record<number, string> = {
  "-2": "Runs hot — sweating in a t-shirt at 40°",
  "-1": "Runs warm",
  "0": "Runs average",
  "1": "Runs cold",
  "2": "Runs cold — always freezing",
};

/**
 * Your own profile (screen G).
 *
 * Every section here is conditional on having something to show, and an
 * empty one is omitted rather than rendered empty: a profile that lists
 * "Most worn" over nothing reads as a bug in the app rather than as a new
 * account.
 */
export function OwnProfile({ profile }: Readonly<{ profile: Profile }>) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl uppercase leading-none">
          {profile.displayName ?? "You"}
        </h1>
        {profile.cityLabel === undefined ? undefined : (
          <p className="m-0 text-sm text-night/60">{profile.cityLabel}</p>
        )}
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

      <ListSection title="How you call it, by band" items={profile.coverage}>
        {(band) => (
          <li
            key={band.bandFloorC}
            className="flex items-center gap-3 text-sm"
          >
            <Bracketed className="w-24 shrink-0 text-night/40">
              {band.label}
            </Bracketed>
            <VerdictMark kind={bandVerdict(band)} />
            <span className="flex-1">{VERDICT_WORD[bandVerdict(band)]}</span>
            <Mono className="text-xs text-night/50">
              {String(band.cold + band.dialed + band.warm)} runs
            </Mono>
          </li>
        )}
      </ListSection>

      <ListSection title="Most worn" items={profile.mostWornItems}>
        {(item) => (
          <li
            key={item.itemId}
            className="flex items-center justify-between text-sm"
          >
            <span>{item.name}</span>
            <Mono className="text-night/40">[{String(item.wearCount)}]</Mono>
          </li>
        )}
      </ListSection>

      <ListSection title="Recent entries" items={profile.recentEntries}>
        {(entry) => (
          <li key={entry.entryId}>
            <Link
              to="/feed/entry/$entryId"
              params={{ entryId: entry.entryId }}
              className="text-sm font-semibold text-night no-underline"
            >
              {entry.verdict === null ? "No verdict yet" : "Entry"}
            </Link>
          </li>
        )}
      </ListSection>
    </div>
  );
}
