import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { verdictLabel } from "../../../lib/contracts";
import {
  formatDistance,
  formatDuration,
  inFahrenheit,
} from "../../../lib/measures";
import { Bracketed, Mono } from "../../../ui";
import type { entryDetailForViewer } from "../entries";
import { ListSection } from "./ListSection";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;



/**
 * One entry, in full (screen D).
 *
 * Almost every block here is conditional on the entry having that thing —
 * a caption, photos, a kit, tags, conditions — and an entry with none of
 * them is a perfectly ordinary entry rather than a broken one. That is
 * eight decisions, and until this moved out of the route none of them
 * could be reached by a test.
 */
export function EntryDetail({
  entry,
  entryId,
  shouldPromptVerdict,
  recordPrompted,
  toggleUseful,
}: Readonly<{
  entry: Entry;
  entryId: string;
  shouldPromptVerdict: boolean;
  recordPrompted: (input: { data: { entryId: string } }) => Promise<unknown>;
  toggleUseful: (input: {
    data: { entryId: string };
  }) => Promise<{ useful: boolean }>;
}>) {
  const [useful, setUseful] = useState({
    count: entry.usefulCount,
    reacted: entry.viewerHasReacted,
  });
  const [pending, setPending] = useState(false);

  // "Prompt once on next open, then never again" (packet A3): the prompt
  // showing at all — not the user acting on it — spends the one-time
  // budget.
  useEffect(() => {
    if (shouldPromptVerdict) void recordPrompted({ data: { entryId } });
  }, [shouldPromptVerdict, entryId, recordPrompted]);

  async function onToggleUseful() {
    setPending(true);
    try {
      const result = await toggleUseful({ data: { entryId } });
      setUseful((previous) => ({
        count: result.useful ? previous.count + 1 : previous.count - 1,
        reacted: result.useful,
      }));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
      {shouldPromptVerdict ? (
        <Link
          to="/feed/verdict/$entryId"
          params={{ entryId }}
          className="flex items-center justify-between rounded-xl border border-teal bg-teal/10 px-4 py-3 text-sm font-semibold text-night no-underline"
        >
          You didn&rsquo;t log a verdict for this run. Add one?
        </Link>
      ) : undefined}

      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl uppercase leading-none">
          {entry.runTitle}
        </h1>
        {entry.verdict === undefined ? undefined : (
          <Bracketed className="text-teal">
            {verdictLabel(entry.verdict) ?? "Dialed"}
          </Bracketed>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Mono className="text-sm text-night/60">
          {formatDistance(entry.distanceM)} · {formatDuration(entry.durationS)}
        </Mono>
        {entry.conditions === undefined ? undefined : (
          <Mono className="text-sm text-teal">
            {inFahrenheit(entry.conditions.tempC)}{" "}
            {entry.conditions.condition}
          </Mono>
        )}
      </div>

      <p className="m-0 text-sm text-night/60">
        {entry.authorDisplayName ?? "A runner"}
      </p>

      {entry.photoKeys.length === 0 ? undefined : (
        <div className="grid grid-cols-2 gap-2">
          {entry.photoKeys.map((key) => (
            <img
              key={key}
              src={`/feed/photo/${key}`}
              alt=""
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      )}

      {entry.caption === undefined ? undefined : (
        <p className="m-0 text-base">{entry.caption}</p>
      )}

      <ListSection title="Kit" items={entry.items}>
        {(item) => (
          <li
            key={item.itemId}
            className="flex items-center justify-between text-sm"
          >
            <span>
              {item.brand === undefined ? "" : `${item.brand} `}
              {item.name}
            </span>
            {item.flag === undefined ? undefined : (
              <Bracketed className="text-xs text-night/40">
                {item.flag.replaceAll("_", " ")}
              </Bracketed>
            )}
          </li>
        )}
      </ListSection>

      {entry.tags.length === 0 ? undefined : (
        <div className="flex flex-wrap gap-2">
          {entry.tags.map((tag) => (
            <Bracketed key={tag} className="text-xs text-night/40">
              {tag.replaceAll("_", " ")}
            </Bracketed>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void onToggleUseful();
        }}
        className={
          useful.reacted
            ? "self-start rounded-full bg-teal px-4 py-2 text-sm font-semibold text-night disabled:opacity-40"
            : "self-start rounded-full border border-night/20 px-4 py-2 text-sm font-semibold disabled:opacity-40"
        }
      >
        Useful <Mono className="ml-1">[{String(useful.count)}]</Mono>
      </button>

      <Link to="/feed" className="text-sm font-semibold text-pink">
        Back to feed
      </Link>
    </div>
  );
}
