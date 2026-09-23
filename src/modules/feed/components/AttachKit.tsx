import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { formatTemp } from "../../../lib/temperature";
import type { Units } from "../../../lib/contracts";
import {
  Bracketed,
  FlowStep,
  inFlight,
  LOG_FLOW,
  Mono,
  PendingLabel,
  Skeleton,
} from "../../../ui";
import { uiGroupLabels } from "../groups";
import type { PickerGroup } from "../picker";
import type { PrefillCandidate } from "../prefill";
import { toggledIn } from "../../../lib/toggled-in";

/**
 * Attach the kit (screen A2), and the whole of the prefill idea.
 *
 * The screen has three resting states before the picker opens — waiting
 * for a location, a most-likely kit to accept in one tap, or nothing to
 * suggest — and which one a runner sees is the feature. None of them could
 * be reached by a test while this lived in a route file.
 *
 * Location is asked for, never required: a denied prompt degrades to the
 * condition-filtered picker rather than blocking the screen.
 */
/**
 * The runner's position, "none" once we know there will not be one, and
 * `undefined` while we are still asking.
 *
 * The three states are the point. This used to answer `undefined` for both
 * "still asking" and "denied", and the caller could not tell them apart —
 * so a denied prompt left the screen on its waiting skeleton forever, with
 * no way to attach a kit at all. The comment here claimed it "degrades to
 * the condition-filtered picker"; it did not.
 */
type Position = GeolocationCoordinates | "none" | undefined;

/**
 * What to ask the closet for, given what we know about where the runner
 * is. No position means no condition filtering — the picker still works,
 * it just cannot rank by weather.
 */
export function pickerQueryFor(coords: Position): {
  lat?: number;
  lng?: number;
} {
  if (coords === undefined || coords === "none") return {};
  return { lat: coords.latitude, lng: coords.longitude };
}

function useCoordinates(): Position {
  const [coords, setCoords] = useState<Position>();
  // Equivalent mutant on the dependency list below: stryker's replacement
  // is a constant array, so the effect still runs exactly once.
  // Stryker disable ArrayDeclaration
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setCoords("none");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords(position.coords);
      },
      () => {
        // Denied or unavailable: there will be no position, and the
        // caller degrades to the condition-filtered picker.
        setCoords("none");
      },
    );
  }, []);
  // Stryker restore ArrayDeclaration
  return coords;
}

export function AttachKit({
  runId,
  prefillFor,
  pickerGroupsFor,
  attachKit,
  units,
}: Readonly<{
  runId: string;
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  prefillFor: (input: {
    data: { lat: number; lng: number };
  }) => Promise<PrefillCandidate | undefined>;
  pickerGroupsFor: (input: {
    data: { lat?: number; lng?: number };
  }) => Promise<PickerGroup[]>;
  attachKit: (input: {
    data: { runId: string; itemIds: string[] };
  }) => Promise<{ entryId: string }>;
}>) {
  const navigate = useNavigate();
  const coords = useCoordinates();
  const [prefill, setPrefill] = useState<
    PrefillCandidate | undefined | "none"
  >();
  const [groups, setGroups] = useState<PickerGroup[] | undefined>();
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  /**
   * The in-flight half of design's round-13 table, which this screen did
   * not have.
   *
   * `disabled={selected.size === 0}` covered only "not yet"; while the
   * attach was actually running the button sat at full strength with
   * nothing stopping a second press — and `attachKit` **creates an
   * entry**, so two presses are two entries. Rule 07 removes the attribute
   * that used to stop the first kind of press, so this is what stops the
   * second.
   */
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (coords === undefined) return;
    if (coords === "none") {
      // Nothing to match a previous run against, so there is no
      // suggestion to make — go straight to the picker rather than
      // waiting for an answer that will not come.
      setPrefill("none");
      return;
    }
    void prefillFor({
      data: { lat: coords.latitude, lng: coords.longitude },
    }).then((candidate) => {
      setPrefill(candidate ?? "none");
    });
  }, [coords, prefillFor]);

  useEffect(() => {
    if (!showPicker || groups !== undefined) return;
    void pickerGroupsFor({ data: pickerQueryFor(coords) }).then(setGroups);
  }, [showPicker, groups, coords, pickerGroupsFor]);

  async function submit(itemIds: string[]) {
    if (attaching) return;
    setError(undefined);
    setAttaching(true);
    try {
      const { entryId } = await attachKit({ data: { runId, itemIds } });
      await navigate({ to: "/feed/verdict/$entryId", params: { entryId } });
    } catch {
      setError("Couldn't save that. Try again.");
      // Only on the failing path: the success path navigates away, and
      // clearing the flag first would reopen the button for the frame
      // before the route changes.
      setAttaching(false);
    }
  }

  return (
    <FlowStep step={LOG_FLOW.attach}>
      <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-title uppercase">
          What did you wear?
        </h1>

        {!showPicker && prefill === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : undefined}

        {!showPicker && prefill && prefill !== "none" ? (
          <div className="flex flex-col gap-3 rounded-card border border-hairline p-4">
            <Bracketed className="text-dialed-text">
              Most likely · from{" "}
              {formatTemp(prefill.conditions.tempC, units.temp)},{" "}
              {Math.round(prefill.feelsLikeDeltaC)}° off
            </Bracketed>
            <button
              type="button"
              onClick={() => {
                void submit(prefill.itemIds);
              }}
              className="target rounded-pill bg-ink px-4 py-3 font-semibold text-ground"
            >
              That&rsquo;s it
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPicker(true);
              }}
              className="target text-body font-semibold text-cold-text"
            >
              Change
            </button>
          </div>
        ) : undefined}

        {!showPicker && prefill === "none" ? (
          <button
            type="button"
            onClick={() => {
              setShowPicker(true);
            }}
            className="target rounded-pill bg-ink px-4 py-3 font-semibold text-ground"
          >
            Choose your kit
          </button>
        ) : undefined}

        {showPicker ? (
          <PickerOrSkeleton
            attaching={attaching}
            groups={groups}
            selected={selected}
            onToggle={(itemId) => {
              setSelected((prev) => toggledIn(prev, itemId));
            }}
            onSubmit={() => {
              void submit([...selected]);
            }}
          />
        ) : undefined}

        {error === undefined ? undefined : (
          <p className="text-small font-semibold text-cold-text">{error}</p>
        )}
      </div>
    </FlowStep>
  );
}

function PickerOrSkeleton({
  attaching,
  groups,
  selected,
  onToggle,
  onSubmit,
}: Readonly<{
  attaching: boolean;
  groups: PickerGroup[] | undefined;
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  onSubmit: () => void;
}>) {
  if (!groups) return <Skeleton className="h-64 w-full" />;
  return (
    <Picker
      attaching={attaching}
      groups={groups}
      selected={selected}
      onToggle={onToggle}
      onSubmit={onSubmit}
    />
  );
}

function Picker({
  attaching,
  groups,
  selected,
  onToggle,
  onSubmit,
}: Readonly<{
  /**
   * Drilled through two components rather than read from a context,
   * because it is one boolean with one reader — the submit button at the
   * bottom of this list — and a context for it would be a second way to
   * ask "is the attach running" alongside the state that answers it.
   */
  attaching: boolean;
  groups: PickerGroup[];
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  onSubmit: () => void;
}>) {
  const [query, setQuery] = useState("");
  return (
    <div className="flex flex-col gap-5">
      <input
        type="search"
        placeholder="Search your closet"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        className="rounded-field border border-hairline bg-panel px-3 py-2"
      />
      {groups.map((group) => {
        const visible = group.items.filter((item) =>
          item.name.toLowerCase().includes(query.toLowerCase()),
        );
        if (visible.length === 0) return;
        return (
          <fieldset key={group.group} className="flex flex-col gap-2">
            <legend>
              <Mono step="xs">{uiGroupLabels[group.group]}</Mono>{" "}
              <Mono className="text-muted">
                [{String(group.matchCount)} of {String(group.items.length)}]
              </Mono>
            </legend>
            {visible.map((item) => (
              <label
                key={item.id}
                className="target flex items-center gap-2 text-body"
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => {
                    onToggle(item.id);
                  }}
                />
                <span>
                  {item.brand ? `${item.brand} ` : ""}
                  {item.name}
                </span>
                {item.untested ? (
                  <Bracketed className="text-muted">untested</Bracketed>
                ) : undefined}
              </label>
            ))}
            {group.hiddenByFilterCount > 0 ? (
              <Mono className="text-muted">
                {String(group.hiddenByFilterCount)} hidden by conditions
              </Mono>
            ) : undefined}
          </fieldset>
        );
      })}
      {/* **Two unavailable states, one button** (design, round 13). *Not
          yet* — nothing selected — is drawn at full strength and stays
          silent on press: "the count is the sentence: it says what is
          missing on the button the runner is looking at", so `Attach 0
          items` is the whole message and there is no band to add. *In
          flight* swaps the label. Neither dims, because rule 02 bans
          opacity as a meaning channel, and neither uses `disabled`,
          because rule 07 bans dropping a control out of the tab order. */}
      <button
        type="button"
        onClick={onSubmit}
        {...inFlight(attaching || selected.size === 0)}
        aria-busy={attaching || undefined}
        className="target rounded-pill bg-ink px-4 py-3 font-semibold text-ground"
      >
        <PendingLabel
          pending={attaching}
          pendingLabel="Attaching"
          label={`Attach ${String(selected.size)} ${selected.size === 1 ? "item" : "items"}`}
        />
      </button>
    </div>
  );
}
