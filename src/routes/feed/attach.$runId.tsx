import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getSession } from "../../modules/auth/functions";
import {
  attachKitAction,
  pickerGroupsQuery,
  prefillQuery,
} from "../../modules/feed/functions";
import type { PickerGroup } from "../../modules/feed/picker";
import type { PrefillCandidate } from "../../modules/feed/prefill";
import { uiGroupLabels } from "../../modules/feed/groups";
import { redirectTo } from "../../modules/feed/redirect";
import { formatTemp } from "../../lib/temperature";
import { Bracketed, Layout, Mono, Skeleton } from "../../ui";

export const Route = createFileRoute("/feed/attach/$runId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  component: AttachKitPage,
});

function useCoordinates(): GeolocationCoordinates | undefined {
  const [coords, setCoords] = useState<GeolocationCoordinates | undefined>();
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords(position.coords);
      },
      () => {
        // Denied or unavailable — the caller degrades to the condition-filtered picker.
      },
    );
  }, []);
  return coords;
}

function AttachKitPage() {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const coords = useCoordinates();
  const [prefill, setPrefill] = useState<PrefillCandidate | undefined | "none">();
  const [groups, setGroups] = useState<PickerGroup[] | undefined>();
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!coords) return;
    void prefillQuery({ data: { lat: coords.latitude, lng: coords.longitude } }).then(
      (candidate) => {
        setPrefill(candidate ?? "none");
      },
    );
  }, [coords]);

  useEffect(() => {
    if (!showPicker || groups) return;
    void pickerGroupsQuery({
      data: coords ? { lat: coords.latitude, lng: coords.longitude } : {},
    }).then(setGroups);
  }, [showPicker, groups, coords]);

  async function submit(itemIds: string[]) {
    setError(undefined);
    try {
      const { entryId } = await attachKitAction({ data: { runId, itemIds } });
      await navigate({ to: "/feed/verdict/$entryId", params: { entryId } });
    } catch {
      setError("Couldn't save that. Try again.");
    }
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-2xl uppercase leading-none">Attach the kit</h1>

        {!showPicker && prefill === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : undefined}

        {!showPicker && prefill && prefill !== "none" ? (
          <div className="flex flex-col gap-3 rounded-xl border border-night/10 p-4">
            <Bracketed className="text-xs text-teal">
              Most likely · from {formatTemp(prefill.conditions.tempC, "f")},{" "}
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
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(itemId)) next.delete(itemId);
                else next.add(itemId);
                return next;
              });
            }}
            onSubmit={() => {
              void submit([...selected]);
            }}
          />
        ) : undefined}

        {error ? <p className="text-sm font-semibold text-pink">{error}</p> : undefined}
      </div>
    </Layout>
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
