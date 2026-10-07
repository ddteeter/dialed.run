import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { CityLookup } from "../../../lib/contracts/city-lookup";
import type { ResolvedPlace, Units } from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/contracts/measures";
import { formatTemp } from "../../../lib/contracts/temperature";
import type { PrecipClass } from "../../../lib/contracts/temperature";
import {
  Bracketed,
  CityFinder,
  classifyFailure,
  ControlFailureBand,
  FailureBand,
  FormStatus,
  Mono,
  useControlAction,
  WeatherAttribution,
} from "../../../ui";
import type { Place } from "../../onboarding";
import type { ConsensusBand, ConsensusResult } from "../consensus";
import { withShares } from "../bar-share";
import type { BarShare } from "../bar-share";
import { uiGroupLabels } from "../groups";
import type { ConditionsHome } from "../home";
import { BracketHeadline } from "./BracketHeadline";

interface Coords {
  lat: number;
  lng: number;
}

/**
Use this: saves the found place through the one writer of the profile's.
*/
type SaveCity = (input: { data: Place }) => Promise<Place>;
type LookUpCity = (input: { data: { label: string } }) => Promise<CityLookup>;

/**
 * What the tab is showing.
 *
 * - `waiting` — asking for the location and fetching, one state (round 22:
 *   *"One state for 'asking' and 'fetching'"*).
 * - `denied` — the runner said no, and has no city saved yet.
 * - `no-weather` — we know where, but no reading has come in for there
 *   (or all we have is a city label O1 saved without its place).
 * - `failed` — the read itself failed; the band says so and retries.
 * - a `ConsensusResult` — matched, widened, or too few.
 */
type TabState =
  "waiting" | "denied" | "no-weather" | ConsensusResult | { failed: string };

/**
 * "Your conditions" (E2-lite), in round 22's four drawn states and the
 * block it waits for.
 *
 * Loaded on demand rather than in the route's loader: it needs the
 * browser's location, which the server rendering the page does not have,
 * and asking for it before the tab is opened would prompt every visitor
 * for a permission most of them never use. **A saved location skips the
 * prompt entirely**, and a runner who has typed a city is never asked
 * again.
 */
export function ConditionsTab({
  home,
  locate,
  conditionsFor,
  lookUpCity,
  saveCity,
  units,
}: Readonly<{
  home: ConditionsHome;
  /**
  The browser's location, or nothing when it is refused or unavailable.
  */
  locate: () => Promise<Coords | undefined>;
  conditionsFor: (input: {
    data: Coords;
  }) => Promise<ConsensusResult | undefined>;
  /**
  Find (round 26 #12): the provider's one answer for a typed city.
  */
  lookUpCity: LookUpCity;
  saveCity: SaveCity;
  units: Units;
}>) {
  const [state, setState] = useState<TabState>("waiting");
  // A city saved on this tab outranks the loader's `home`, which was read
  // before the save: without it, a retry after a failed read prompted for
  // the location again and put the city form back (PR #102 review).
  const saved = useRef<Coords>(undefined);
  // The provider's name for the place being looked at, shown as the
  // header (round 26 #12: `WEATHER FOR {RESOLVED}`), so a bare "Portland"
  // cannot silently be the wrong one. A saved city with its coordinates
  // has one from the start; the browser's own location has none. State
  // rather than the ref above: it is drawn, so setting it renders.
  const [placeName, setPlaceName] = useState(
    home.coords === undefined ? undefined : home.cityLabel,
  );
  // The screen's one status region (Accessibility Contract rule 08), here
  // rather than in the city form, so "City saved." outlives the form.
  const [status, setStatus] = useState("");

  const lookAt = useCallback(
    async (coords: Coords) => {
      setState("waiting");
      try {
        setState((await conditionsFor({ data: coords })) ?? "no-weather");
      } catch (error: unknown) {
        setState({ failed: classifyFailure(error).message });
      }
    },
    [conditionsFor],
  );

  const look = useCallback(async () => {
    setState("waiting");
    const coords = saved.current ?? home.coords ?? (await locate());
    if (coords === undefined) {
      setState(home.cityLabel === undefined ? "denied" : "no-weather");
      return;
    }
    await lookAt(coords);
  }, [home, locate, lookAt]);

  useEffect(() => {
    void look();
  }, [look]);

  return (
    <>
      <FormStatus>{status}</FormStatus>
      {placeName === undefined ? undefined : (
        <ResolvedPlace address={placeName} />
      )}
      <StateBlock
        state={state}
        units={units}
        place={placeName ?? home.cityLabel}
        city={{ lookUpCity, saveCity, announce: setStatus }}
        onSaved={(city) => {
          saved.current = { lat: city.lat, lng: city.lng };
          setPlaceName(city.cityLabel);
          return lookAt(saved.current);
        }}
        onRetry={() => {
          void look();
        }}
      />
    </>
  );
}

/**
 * The place being looked at, in the provider's words — the answer to
 * "which Portland?" — as round 26 #12 draws the header: `WEATHER FOR
 * PORTLAND, OR, UNITED STATES`, the same string O1's chip shows.
 */
function ResolvedPlace({ address }: Readonly<{ address: string }>) {
  return (
    <p data-part="resolved-place" className="m-0 pt-5 text-muted">
      <Mono step="xs">Weather for {address}</Mono>
    </p>
  );
}

/**
What the location-denied state needs to find a city and use it.
*/
interface CityActions {
  lookUpCity: LookUpCity;
  saveCity: SaveCity;
  announce: (status: string) => void;
}

function StateBlock({
  state,
  units,
  place,
  city,
  onSaved,
  onRetry,
}: Readonly<{
  state: TabState;
  units: Units;
  /**
  The place's name, when there is one, for "No weather for {place} yet".
  */
  place: string | undefined;
  city: CityActions;
  onSaved: (city: Place) => Promise<void>;
  onRetry: () => void;
}>) {
  if (state === "waiting") {
    return (
      <div
        data-part="match-block"
        data-state="waiting"
        aria-busy="true"
        className="flex flex-col gap-2 border-b border-hairline py-5"
      >
        <Eyebrow>Your conditions</Eyebrow>
        <BracketHeadline pending>Finding weather</BracketHeadline>
      </div>
    );
  }
  if (state === "denied") {
    return <CityForm {...city} onSaved={onSaved} />;
  }
  if (state === "no-weather") return <NoWeather place={place} />;
  if ("failed" in state) {
    return (
      <FailureBand
        kicker="Didn't load"
        message={state.failed}
        onRetry={onRetry}
      />
    );
  }
  if (state.status === "too-few") {
    return <TooFew band={state.band} units={units} />;
  }
  return <Matched result={state} units={units} />;
}

function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Mono step="xs" className="text-muted">
      {children}
    </Mono>
  );
}

/**
 * Round 25's precip words — *"dry, damp, rain, snow. All four read
 * naturally after '44° and'"*. The match has three classes, and its
 * heaviest reads as rain; nothing here tells snow from rain yet.
 */
const PRECIP_WORD: Readonly<Record<PrecipClass, string>> = {
  dry: "dry",
  damp: "damp",
  wet: "rain",
};

/**
 * What was matched, in words: `44° and damp`. The viewer's own feels-like,
 * because the eyebrow already says FEELS and gives the band.
 */
function matchedConditions(band: ConsensusBand, units: Units): string {
  return `${formatTemp(band.feelsC, units.temp)} and ${PRECIP_WORD[band.precip]}`;
}

/**
 * Round 25: `SAME CONDITIONS · FEELS [41–47°] · DAMP · 3 DAYS`. Only the
 * two things matched are named — no wind, and no place, because the match
 * ignores where a run was (owner, 2026-09-24). The empty state draws it
 * without the window.
 */
function SameConditionsEyebrow({
  band,
  windowDays,
  units,
}: Readonly<{ band: ConsensusBand; windowDays?: number; units: Units }>) {
  return (
    <Mono step="xs">
      Same conditions · Feels{" "}
      <Bracketed step="xs">
        {formatTempRange(band.minC, band.maxC, units.temp)}
      </Bracketed>{" "}
      · {PRECIP_WORD[band.precip]}
      {windowDays === undefined ? undefined : ` · ${String(windowDays)} days`}
    </Mono>
  );
}

function CityForm({
  lookUpCity,
  saveCity,
  announce,
  onSaved,
}: Readonly<CityActions & { onSaved: (city: Place) => Promise<void> }>) {
  const [typed, setTyped] = useState("");
  const save = useControlAction({
    action: async (found: ResolvedPlace) => saveCity({ data: placeOf(found) }),
    kicker: "Not saved",
    onSuccess: async (found) => {
      announce("City saved.");
      await onSaved(placeOf(found));
    },
  });

  // Not a failure: the runner said no, and that is allowed — so no band
  // and no yellow, just the question the location would have answered.
  return (
    <div
      data-part="match-block"
      data-state="location-denied"
      className="flex flex-col gap-4 py-5"
    >
      <Eyebrow>Your conditions</Eyebrow>
      <h2 className="m-0 font-display text-title uppercase">
        Where do you run?
      </h2>
      <p className="m-0 text-lead">
        Location is off. Type your city and we&rsquo;ll match its weather
        instead.
      </p>
      <CityFinder
        name="cityLabel"
        label="Your city"
        value={typed}
        onChange={setTyped}
        lookUp={lookUpCity}
        onUse={(found) => {
          void save.run(found);
        }}
        using={save.pending}
        announce={announce}
      />
      <ControlFailureBand
        failure={save.failure}
        onRetry={save.retry}
        retryRef={save.retryRef}
      />
      <p className="m-0 text-small text-muted">
        Saved to your settings. Change it any time under You.
      </p>
    </div>
  );
}

/**
The found place as the profile stores it: the provider's name is the label.
*/
function placeOf(found: ResolvedPlace): Place {
  return { cityLabel: found.address, lat: found.lat, lng: found.lng };
}

/**
The Call, as the secondary way out of an empty block (hairline, not ink).
*/
function OpenTheCall() {
  return (
    <Link
      to="/call"
      className="target inline-flex items-center self-start rounded-pill border border-hairline px-5 py-3 text-body font-semibold text-ink no-underline"
    >
      Open the Call
    </Link>
  );
}

/**
 * Round 22's No matches: the window already widened, and the sentence
 * says why there is nothing — the privacy floor, not an empty world.
 */
function TooFew({
  band,
  units,
}: Readonly<{ band: ConsensusBand; units: Units }>) {
  // The block is the eyebrow and the headline, and what it says follows
  // it — the board's own split, and the same as the matched state's.
  return (
    <div className="flex flex-col">
      <div
        data-part="match-block"
        data-state="no-matches"
        className="flex flex-col gap-2 border-b border-hairline py-5 text-muted"
      >
        <SameConditionsEyebrow band={band} units={units} />
        <p className="m-0 font-display text-title uppercase text-ink">
          Not enough runs yet
        </p>
      </div>
      <div className="flex flex-col gap-4 py-5">
        <p className="m-0 text-lead">
          Fewer than five runners logged {matchedConditions(band, units)} in two
          weeks, which is too few to show without showing who.
        </p>
        <p className="m-0 text-body text-quiet">
          Your own record in this band is on the Call.
        </p>
        <OpenTheCall />
        <WeatherAttribution />
      </div>
    </div>
  );
}

/**
 * A bar's colour in words (round 26 #9: *"Any bar colour also needs a
 * label in words"*, rule 10), in round 27 #25's words: which bar gets
 * which is `barShares`. Pink is every word but Some.
 */
const BAR_WORD = {
  all: "All",
  split: "Split",
  most: "Most",
  some: "Some",
} as const satisfies Record<BarShare, string>;
const BAR_FILL = {
  all: "bg-action",
  split: "bg-action",
  most: "bg-action",
  some: "bg-hairline-2",
} as const satisfies Record<BarShare, string>;

/**
 * No reading has come in for where the runner is — or all we have is a
 * typed city, which names a place without locating it. Law 5: say we do
 * not know, never that nobody ran. Round 26 #9 names the place: "No
 * weather for Portland, OR yet. It shows after the first reading."
 */
function NoWeather({ place }: Readonly<{ place: string | undefined }>) {
  return (
    <div
      data-part="match-block"
      data-state="no-weather"
      className="flex flex-col gap-4 py-5"
    >
      <Eyebrow>Your conditions</Eyebrow>
      <p className="m-0 font-display text-title uppercase">No weather yet</p>
      <p className="m-0 text-lead">
        No weather for {place ?? "where you are"} yet. It shows after the first
        reading.
      </p>
      <OpenTheCall />
    </div>
  );
}

/**
 * Past the floor: how many runners, and what they wore. Teal means
 * "matched" and nothing else, which is why the empty states sit on paper.
 */
function Matched({
  result,
  units,
}: Readonly<{
  result: Extract<ConsensusResult, { status: "matched" }>;
  units: Units;
}>) {
  const isWidened = result.windowDays === 14;
  const conditions = matchedConditions(result.band, units);
  const bars = withShares(result.groups, result.runners);
  return (
    <div className="flex flex-col">
      <div
        data-part="match-block"
        data-state={isWidened ? "widened" : "matched"}
        className="flex flex-col gap-2 bg-teal px-5 py-5 text-ink desk:rounded-card"
      >
        <SameConditionsEyebrow
          band={result.band}
          windowDays={result.windowDays}
          units={units}
        />
        <p className="m-0 font-display text-title uppercase">
          {String(result.runners)} runners logged this
        </p>
        <p className="m-0 text-body">
          {isWidened
            ? `In ${conditions}, wherever they were. Too few in three days, so this looks back two weeks.`
            : `In ${conditions}, in the last three days, wherever they were.`}
        </p>
      </div>
      <div className="flex flex-col gap-3 py-5">
        {result.groups.length === 0 ? undefined : (
          <>
            <Eyebrow>What they wore</Eyebrow>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {bars.map(({ row, share }) => {
                return (
                  <li
                    key={row.group}
                    data-share={share}
                    className="flex items-center gap-3"
                  >
                    <span className="h-6 flex-1 rounded-tight bg-tint">
                      <span
                        className={`block h-full rounded-tight ${BAR_FILL[share]}`}
                        style={{
                          width: `${String(Math.round((row.runners / result.runners) * 100))}%`,
                        }}
                      />
                    </span>
                    <span className="flex w-44 items-baseline justify-between gap-2 text-body">
                      {uiGroupLabels[row.group]}
                      <span className="flex items-baseline gap-2 text-muted">
                        <Mono step="xs">{BAR_WORD[share]}</Mono>
                        <Mono>
                          {String(row.runners)}/{String(result.runners)}
                        </Mono>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <WeatherAttribution />
      </div>
    </div>
  );
}
