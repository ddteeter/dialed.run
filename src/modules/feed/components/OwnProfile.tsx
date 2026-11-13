import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  Bracketed,
  Icon,
  ListSection,
  Mono,
  PhoneBell,
  Spoken,
  VerdictMark,
  WeatherAttribution,
} from "../../../ui";
import type { VerdictKind } from "../../../ui";
import { measuredLine } from "../../../lib/contracts/measures";
import type { Units } from "../../../lib/contracts";
import { bandVerdict } from "../coverage";
import { stripConditions } from "../strip";
import { ConditionsCell } from "./ConditionsCell";
import type { ownProfile } from "../profiles";
import { BracketHeadline } from "./BracketHeadline";
import { Avatar } from "./Avatar";
import { Handle } from "./Handle";
import { UnderReview } from "./UnderReview";

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
 * - **Round 26 #11's nag sits on top** while the address is unconfirmed:
 *   `confirmBand` is `account`'s band, composed by the route, and draws
 *   nothing once the address is confirmed.
 */
export function OwnProfile({
  profile,
  confirmBand,
}: Readonly<{ profile: Profile; confirmBand: ReactNode }>) {
  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0">
      {confirmBand}
      <div data-part="header" className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={profile.username ?? "You"} size="large" />
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="m-0 text-heading">
              {profile.username === undefined ? (
                "You"
              ) : (
                <Handle username={profile.username} />
              )}
            </h1>
            {profile.cityLabel === undefined ? undefined : (
              <Mono className="text-muted">{profile.cityLabel}</Mono>
            )}
          </div>
          <SettingsButton />
          <PhoneBell />
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
                  {/* "41–50°" drawn, "41 to 50 degrees" said (round 53 ·
                      162.3). */}
                  <Spoken shown={band.label} said={band.said} />
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
          {/* The bands are feels-like bands, read from the provider's
              observations: derived data, credited beside it (D-144). */}
          {profile.coverage.length > 0 ? <WeatherAttribution /> : undefined}

          <ListSection title="Most worn" items={profile.mostWornItems}>
            {(item) => (
              <li
                key={item.itemId}
                className="flex items-center justify-between text-body"
              >
                <span>{item.name}</span>
                {/* The brackets are drawn, not said: `Bracketed` hides them,
                    so the count is read as its number (PR#286-1). */}
                <Bracketed className="text-muted">
                  {String(item.wearCount)}
                </Bracketed>
              </li>
            )}
          </ListSection>

          <ListSection title="Recent entries" items={profile.recentEntries}>
            {(entry) => (
              <RecentEntryRow
                key={entry.entryId}
                entry={entry}
                units={profile.units}
              />
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
        className="target inline-flex items-center rounded-pill bg-action px-6 py-3 text-body font-bold text-accent-ink no-underline"
      >
        Log a run
      </Link>
      <SettingsLink />
    </div>
  );
}

/**
 * G's way to Settings in every state (round 26 #18): the pack's `settings`
 * glyph, a 44×44 button named "Settings", at the right of the identity
 * line. Settings is the only place to sign out (PR #104), so no state of G
 * may be without it.
 */
function SettingsButton() {
  return (
    <Link
      to="/onboarding/settings"
      aria-label="Settings"
      data-part="settings-button"
      className="target inline-flex size-11 shrink-0 items-center justify-center text-ink no-underline"
    >
      <Icon name="settings" size={20} />
    </Link>
  );
}

/**
 * Day one's inline link to Settings, inside the next step, where round 22
 * draws it. Round 26 #18 keeps it on day one beside the icon button; the
 * established G has the icon only.
 */
function SettingsLink() {
  return (
    <Link
      to="/onboarding/settings"
      className="target flex w-full items-center justify-between border-y border-hairline py-3 text-body text-ink no-underline"
    >
      Settings
      <span aria-hidden="true" className="text-muted">
        &rsaquo;
      </span>
    </Link>
  );
}

/**
 * One of G's Recent entries, as round 35 #53b draws it: the link names the
 * run — "Sat, Aug 29 · 8.2 mi" — and the meta line under it carries the
 * card's tag first, outside the link (so the link's name stays the row's
 * label and the tag is read once), then the conditions in the card strip's
 * own cell: the range the run covered (R-5), or Indoor, or nothing.
 */
function RecentEntryRow({
  entry,
  units,
}: Readonly<{ entry: Profile["recentEntries"][number]; units: Units }>) {
  const conditions = stripConditions(entry.conditions, entry.indoor, units);
  return (
    <li className="flex flex-col gap-1 border-t border-hairline py-3">
      <Link
        to="/feed/entry/$entryId"
        params={{ entryId: entry.entryId }}
        className="target inline-flex items-center text-body font-semibold text-ink"
      >
        {/* "Sat, Aug 29 · 8.2 mi", said "Sat, Aug 29, 8.2 miles" (round
            52 #158). */}
        <Spoken
          {...measuredLine(
            [
              [{ kind: "word", word: entry.day }],
              [{ kind: "distance", distanceM: entry.distanceM, spaced: true }],
            ],
            units,
          )}
        />
      </Link>
      {conditions !== undefined || entry.underReview ? (
        <span data-part="entry-meta" className="flex flex-wrap gap-3">
          {entry.underReview ? <UnderReview /> : undefined}
          {conditions === undefined ? undefined : (
            <ConditionsCell cell={conditions} />
          )}
        </span>
      ) : undefined}
    </li>
  );
}
