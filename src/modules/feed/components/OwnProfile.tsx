import { Link } from "@tanstack/react-router";

import { Bracketed, ListSection, Mono, VerdictMark } from "../../../ui";
import type { VerdictKind } from "../../../ui";
import { bandVerdict } from "../coverage";
import type { ownProfile } from "../profiles";
import { BracketHeadline } from "./BracketHeadline";
import { Avatar } from "./Avatar";

type Profile = Awaited<ReturnType<typeof ownProfile>>;

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

/**
 * Your own profile — screen G, drawn with only what v1 stores (round 22,
 * "G New account").
 *
 * - **Counts show as zeros** — runs, following, followers. Hiding them
 *   makes a new profile look broken, not new.
 * - **A new G gets one next step**: `[ NO RUNS YET ]`, a line, and Log a
 *   run. No badges, no "complete your profile" meter.
 * - **Everything else appears as it gains data**: the band record, the
 *   most-worn pieces and the recent entries are absent until there is
 *   something in them — none is drawn empty.
 * - The line under the name is the city, when O1 got one, and nothing
 *   otherwise.
 */
export function OwnProfile({ profile }: Readonly<{ profile: Profile }>) {
  const name = profile.displayName ?? "You";
  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0">
      <div data-part="header" className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={name} size="large" />
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-heading">{name}</h1>
            {profile.cityLabel === undefined ? undefined : (
              <Mono className="text-muted">{profile.cityLabel}</Mono>
            )}
          </div>
        </div>
        <p data-part="counts" className="m-0 flex gap-5 text-muted">
          <Count value={profile.runCount} label="Runs" />
          <Count value={profile.followingCount} label="Following" />
          <Count value={profile.followerCount} label="Followers" />
        </p>
      </div>

      {profile.runCount === 0 ? (
        <DayOne />
      ) : (
        <>
          <ListSection
            title="How you call it, by band"
            items={profile.coverage}
          >
            {(band) => (
              <li
                key={band.bandFloorC}
                className="flex items-center gap-3 text-body"
              >
                <Bracketed className="w-24 shrink-0 text-muted">
                  {band.label}
                </Bracketed>
                <VerdictMark kind={bandVerdict(band)} />
                <span className="flex-1">
                  {VERDICT_WORD[bandVerdict(band)]}
                </span>
                <Mono className="text-muted">
                  {String(band.cold + band.dialed + band.warm)} runs
                </Mono>
              </li>
            )}
          </ListSection>

          <ListSection title="Most worn" items={profile.mostWornItems}>
            {(item) => (
              <li
                key={item.itemId}
                className="flex items-center justify-between text-body"
              >
                <span>{item.name}</span>
                <Mono className="text-muted">[{String(item.wearCount)}]</Mono>
              </li>
            )}
          </ListSection>

          <ListSection title="Recent entries" items={profile.recentEntries}>
            {(entry) => (
              <li key={entry.entryId}>
                <Link
                  to="/feed/entry/$entryId"
                  params={{ entryId: entry.entryId }}
                  className="target inline-flex items-center text-body font-semibold text-ink no-underline"
                >
                  {entry.verdict === null ? "No verdict yet" : "Entry"}
                </Link>
              </li>
            )}
          </ListSection>
        </>
      )}
    </div>
  );
}

/**
A count and what it counts: the number in ink, the word quieter.
*/
function Count({ value, label }: Readonly<{ value: number; label: string }>) {
  return (
    <Mono>
      <span className="text-ink">{String(value)}</span> {label}
    </Mono>
  );
}

/**
 * Day one: the next step, and the way to settings. *"Your runs land here
 * once you log one. Shared runs are what other people see."*
 */
function DayOne() {
  return (
    <div
      data-part="entries"
      data-state="empty"
      className="flex flex-col items-start gap-3 pt-4"
    >
      <BracketHeadline>No runs yet</BracketHeadline>
      <p className="m-0 text-lead">
        Your runs land here once you log one. Shared runs are what other people
        see.
      </p>
      <Link
        data-part="primary-action"
        to="/runs/new"
        className="target inline-flex items-center rounded-pill bg-action px-6 py-3 text-body font-bold text-ink no-underline"
      >
        Log a run
      </Link>
      <Link
        to="/onboarding/settings"
        className="target flex w-full items-center justify-between border-y border-hairline py-3 text-body text-ink no-underline"
      >
        Settings
        <span aria-hidden="true" className="text-muted">
          &rsaquo;
        </span>
      </Link>
    </div>
  );
}
