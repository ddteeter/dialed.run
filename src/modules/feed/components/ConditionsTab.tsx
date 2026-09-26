import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { Units } from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/measures";
import { formatTemp } from "../../../lib/temperature";
import type { PrecipClass } from "../../../lib/temperature";
import {
  Bracketed,
  classifyFailure,
  FailureBand,
  FormFailureBand,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import type { ConsensusBand, ConsensusResult } from "../consensus";
import { uiGroupLabels } from "../groups";
import type { ConditionsHome, SavedCity } from "../home";
import { conditionsCityInput } from "../inputs";
import { BracketHeadline } from "./BracketHeadline";

interface Coords {
  lat: number;
  lng: number;
}

type SaveCity = (input: { data: { cityLabel: string } }) => Promise<SavedCity>;

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
  Finds the typed city and saves it as the profile's place, answering with
  where it is and the provider's name for it.
  */
  saveCity: SaveCity;
  units: Units;
}>) {
  const [state, setState] = useState<TabState>("waiting");
  // A city saved on this tab outranks the loader's `home`, which was read
  // before the save: without it, a retry after a failed read prompted for
  // the location again and put the city form back (PR #102 review).
  const saved = useRef<Coords>(undefined);
  // The provider's name for the city just saved, shown back so a bare
  // "Portland" cannot silently become the wrong one (PR #102 review).
  // State rather than the ref above: it is drawn, so setting it renders.
  const [placeName, setPlaceName] = useState<string>();

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
      {placeName === undefined ? undefined : (
        <ResolvedPlace address={placeName} />
      )}
      <StateBlock
        state={state}
        units={units}
        saveCity={saveCity}
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
 * The saved city, in the provider's words — the answer to "which
 * Portland?". Placeholder copy pending design (undesigned surface).
 */
function ResolvedPlace({ address }: Readonly<{ address: string }>) {
  return (
    <p data-part="resolved-place" className="m-0 pt-5 text-small text-muted">
      Weather for <span className="font-semibold text-ink">{address}</span>
    </p>
  );
}

function StateBlock({
  state,
  units,
  saveCity,
  onSaved,
  onRetry,
}: Readonly<{
  state: TabState;
  units: Units;
  saveCity: SaveCity;
  onSaved: (city: SavedCity) => Promise<void>;
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
    return <CityForm saveCity={saveCity} onSaved={onSaved} />;
  }
  if (state === "no-weather") return <NoWeather />;
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
  saveCity,
  onSaved,
}: Readonly<{
  saveCity: SaveCity;
  onSaved: (city: SavedCity) => Promise<void>;
}>) {
  const [cityLabel, setCityLabel] = useState("");
  const form = useFormSubmit({
    schema: conditionsCityInput,
    action: (values) => saveCity({ data: values }),
    onSuccess: onSaved,
    successMessage: "City saved.",
  });

  // Not a failure: the runner said no, and that is allowed — so no band
  // and no yellow, just the question the location would have answered.
  return (
    <form
      ref={form.formRef}
      noValidate
      data-part="match-block"
      data-state="location-denied"
      className="flex flex-col gap-4 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ cityLabel });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <Eyebrow>Your conditions</Eyebrow>
      <h2 className="m-0 font-display text-title uppercase">
        Where do you run?
      </h2>
      <p className="m-0 text-lead">
        Location is off. Type your city and we&rsquo;ll match its weather
        instead.
      </p>
      <TextField
        name="cityLabel"
        label="City"
        hint="City and state, e.g. Portland, OR"
        value={cityLabel}
        onChange={setCityLabel}
        field={form.field}
        error={form.fieldErrors.cityLabel}
        autoComplete="address-level2"
      />
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Use this city"
        pendingLabel="Saving"
        pending={form.pending}
      />
      <p className="m-0 text-small text-muted">
        Saved to your settings. Change it any time under You.
      </p>
    </form>
  );
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
      </div>
    </div>
  );
}

/**
 * No reading has come in for where the runner is — or all we have is a
 * typed city, which names a place without locating it. Law 5: say we do
 * not know, never that nobody ran.
 */
function NoWeather() {
  return (
    <div
      data-part="match-block"
      data-state="no-weather"
      className="flex flex-col gap-4 py-5"
    >
      <Eyebrow>Your conditions</Eyebrow>
      <p className="m-0 font-display text-title uppercase">No weather yet</p>
      <p className="m-0 text-lead">
        No reading has come in for where you are, so there is nothing to match
        yet.
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
  return (
    <div className="flex flex-col">
      <div
        data-part="match-block"
        data-state={isWidened ? "widened" : "matched"}
        className="flex flex-col gap-2 bg-teal px-5 py-5 text-ink"
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
      {result.groups.length === 0 ? undefined : (
        <div className="flex flex-col gap-3 py-5">
          <Eyebrow>What they wore</Eyebrow>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {result.groups.map((row) => (
              <li key={row.group} className="flex items-center gap-3">
                <span className="h-6 flex-1 rounded-tight bg-tint">
                  <span
                    className={`block h-full rounded-tight ${
                      row.runners * 2 > result.runners
                        ? "bg-action"
                        : "bg-hairline-2"
                    }`}
                    style={{
                      width: `${String(Math.round((row.runners / result.runners) * 100))}%`,
                    }}
                  />
                </span>
                <span className="flex w-32 items-baseline justify-between gap-2 text-body">
                  {uiGroupLabels[row.group]}
                  <Mono className="text-muted">
                    {String(row.runners)}/{String(result.runners)}
                  </Mono>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
