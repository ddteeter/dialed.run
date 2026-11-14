import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  COLUMN,
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
import type { Units } from "../../../lib/contracts";
import { FlushBand } from "./FlushBand";
import { formatTemp, precipClassOf } from "../../../lib/contracts/temperature";
import { bandVerdict } from "../coverage";
import { counted } from "../counted";
import { BOUND_SEPARATOR } from "../posted";
import type { ownProfile } from "../profiles";
import { BracketHeadline } from "./BracketHeadline";
import { Avatar } from "./Avatar";
import { Handle } from "./Handle";
import { RunRow } from "./RunRow";

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
    <div className={`${COLUMN} flex flex-col gap-6 px-5 pt-6 wide:px-6`}>
      <FlushBand>{confirmBand}</FlushBand>
      <div data-part="header" className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={profile.username ?? "You"} size="large" />
          {/* `min-w-0` and `wrap-anywhere`: at 320 (reflow) a long handle
              breaks rather than push Settings and the bell off the row,
              as another runner's does. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="m-0 text-heading wrap-anywhere">
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
        {/* R55·209b, d: in ink, one for one ("1 RUN"), as 209f draws
            them, each "·" bound to the count after it. */}
        <p data-part="counts" className="m-0 text-ink">
          <Mono>
            {[
              counted(profile.runCount, "Run", "Runs"),
              counted(profile.followingCount, "Following", "Following"),
              counted(profile.followerCount, "Follower", "Followers"),
            ].join(BOUND_SEPARATOR)}
          </Mono>
        </p>
      </div>

      <ProfileBody profile={profile} />
    </div>
  );
}

/**
 * Below the header: day one, R55·209f's one next step while there are
 * runs and no kit on any, or the sections that have something in them.
 */
function ProfileBody({ profile }: Readonly<{ profile: Profile }>) {
  if (profile.runCount === 0) return <DayOne />;
  if (profile.nextStep !== undefined) {
    return <NextStep step={profile.nextStep} units={profile.units} />;
  }
  return (
    <>
      <ListSection title="How you call it, by band" items={profile.coverage}>
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
            {/* R55·209a, e: the word bold, and the count beside it rather
                than at the row's far end. */}
            <span className="font-semibold">
              {VERDICT_WORD[bandVerdict(band)]}
            </span>
            <Mono className="text-muted">
              {counted(band.cold + band.dialed + band.warm, "run", "runs")}
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
            className="flex items-center justify-between gap-3 text-body"
          >
            {/* Brand and model, as D names it (R55·209c). */}
            <span className="min-w-0">{item.name}</span>
            {/* The brackets are drawn, not said: `Bracketed` hides them,
                so the count is read as its words (PR#286-1). */}
            <Bracketed className="shrink-0 text-muted">
              {counted(item.wearCount, "run", "runs")}
            </Bracketed>
          </li>
        )}
      </ListSection>

      <ListSection title="Recent entries" items={profile.recentEntries} isRuled>
        {(entry) => (
          <RunRow key={entry.entryId} run={entry} units={profile.units} />
        )}
      </ListSection>
    </>
  );
}

/**
 * R55·209f: runs but no kit on any of them, so every section would be
 * empty. One next step instead — the last run, and the kit to add to it —
 * then Settings. What the closet would start learning is the run's own
 * weather; with none, the clause goes (owner, 2026-11-14).
 */
function NextStep({
  step,
  units,
}: Readonly<{
  step: NonNullable<Profile["nextStep"]>;
  units: Units;
}>) {
  const learning =
    step.conditions === undefined
      ? "what works"
      : `what works at ${formatTemp(step.conditions.feelsLikeC, units.temp)} and ${precipClassOf(step.conditions.precipMm)}`;
  return (
    <div
      data-part="next-step"
      className="flex flex-col items-stretch gap-3 border-t border-hairline pt-4"
    >
      <h2 className="m-0">
        <Mono step="xs" className="text-muted">
          Next
        </Mono>
      </h2>
      <p className="m-0 text-lead">
        Your last run has no kit yet. Add what you wore, and your closet starts
        learning {learning}.
      </p>
      <Link
        data-part="primary-action"
        to="/feed/attach/$runId"
        params={{ runId: step.runId }}
        className="target flex min-h-control items-center justify-center rounded-card bg-action font-display text-body text-accent-ink uppercase no-underline"
      >
        Add your kit
      </Link>
      <SettingsLink />
    </div>
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
