import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { inFahrenheit } from "../../../lib/measures";
import { Bracketed, Mono, Skeleton } from "../../../ui";
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
}: Readonly<{
  runId: string;
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
  const [prefill, setPrefill] = useState<PrefillCandidate | undefined | "none">();
  const [groups, setGroups] = useState<PickerGroup[] | undefined>();
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();

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
    setError(undefined);
    try {
      const { entryId } = await attachKit({ data: { runId, itemIds } });
      await navigate({ to: "/feed/verdict/$entryId", params: { entryId } });
    } catch {
      setError("Couldn't save that. Try again.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-2xl uppercase leading-none">Attach the kit</h1>

        {!showPicker && prefill === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : undefined}

        {!showPicker && prefill && prefill !== "none" ? (
          <div className="flex flex-col gap-3 rounded-xl border border-night/10 p-4">
            <Bracketed className="text-xs text-teal">
              Most likely · from {inFahrenheit(prefill.conditions.tempC)},{" "}
              {Math.round(prefill.feelsLikeDeltaC)}° off
            </Bracketed>
            <button
              type="button"
              onClick={() => {
                void submit(prefill.itemIds);
              }}
              className="rounded-md bg-night px-4 py-3 font-semibold text-chalk"
            >
              That&rsquo;s it
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPicker(true);
              }}
              className="text-sm font-semibold text-pink"
            >
              Choose different items
            </button>
          </div>
        ) : undefined}

        {!showPicker && prefill === "none" ? (
          <button
            type="button"
            onClick={() => {
              setShowPicker(true);
            }}
            className="rounded-md bg-night px-4 py-3 font-semibold text-chalk"
          >
            Choose your kit
          </button>
        ) : undefined}

        {showPicker ? (
          <PickerOrSkeleton
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
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
    </div>
  );
}

function PickerOrSkeleton({
  groups,
  selected,
  onToggle,
  onSubmit,
}: Readonly<{
  groups: PickerGroup[] | undefined;
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  onSubmit: () => void;
}>) {
  if (!groups) return <Skeleton className="h-64 w-full" />;
  return (
    <Picker groups={groups} selected={selected} onToggle={onToggle} onSubmit={onSubmit} />
  );
}

function Picker({
  groups,
  selected,
  onToggle,
  onSubmit,
}: Readonly<{
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
        className="rounded-md border border-night/20 bg-white px-3 py-2"
      />
      {groups.map((group) => {
        const visible = group.items.filter((item) =>
          item.name.toLowerCase().includes(query.toLowerCase()),
        );
        if (visible.length === 0) return;
        return (
          <fieldset key={group.group} className="flex flex-col gap-2">
            <legend className="font-semibold uppercase text-sm">
              {uiGroupLabels[group.group]}{" "}
              <Mono className="text-night/40">
                [{String(group.matchCount)} of {String(group.items.length)}]
              </Mono>
            </legend>
            {visible.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
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
                  <Bracketed className="text-night/40">untested</Bracketed>
                ) : undefined}
              </label>
            ))}
            {group.hiddenByFilterCount > 0 ? (
              <Mono className="text-xs text-night/40">
                {String(group.hiddenByFilterCount)} hidden by conditions
              </Mono>
            ) : undefined}
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={onSubmit}
        disabled={selected.size === 0}
        className="rounded-md bg-night px-4 py-3 font-semibold text-chalk disabled:opacity-40"
      >
        Attach {String(selected.size)} {selected.size === 1 ? "item" : "items"}
      </button>
    </div>
  );
}
