import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { entryTagSchema } from "../../../lib/contracts";
import type { Units } from "../../../lib/contracts";
import { formatDistance, formatPace } from "../../../lib/measures";
import { FormStatus, Icon, Mono } from "../../../ui";
import { tagLabel } from "../chips";
import type { EntryTag } from "../chips";
import type { entryDetailForViewer } from "../entries";
import { runWhenLabel } from "../posted";
import { stripConditions } from "../strip";
import { ConditionsCell } from "./ConditionsCell";
import { ReportFoot } from "./ReportFoot";
import { UsefulButton } from "./UsefulButton";
import type { ToggleUsefulFn } from "./useful-reaction";
import { VerdictBadge } from "./VerdictBadge";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
 * A per-item flag as D marks it at the row's end (round 22):
 * `[TOO MUCH]` / `[NOT ENOUGH]`; Fine shows nothing.
 */
const FLAG_MARK: Readonly<Record<"too_much" | "not_enough", string>> = {
  too_much: "[Too much]",
  not_enough: "[Not enough]",
};

/**
 * One entry, in full — screen D, as round 22 draws it "when it isn't
 * full" ("D Sparse own entry", "D Someone else's entry").
 *
 * **Order:** photo pager, run strip, note, kit, tags, Useful, Report. The
 * run strip is the one part every entry has; everything else is present
 * or absent, never a placeholder.
 *
 * - **The owner's verdict prompt takes the badge's place** — directly under
 *   the strip where the badge would be read, square, `--dialed-tint` on a
 *   teal hairline, an ink button opening A3. Owner only, never on a shared
 *   post, and not a banner above the page.
 * - **Photos are a pager**, one at a time with a `1 / 2` counter; the grid
 *   is gone.
 * - **Report is a quiet foot link**, never in the header, whose slot is
 *   for back.
 */
export interface EntryDetailProps {
  entry: Entry;
  /**
  Who is looking — the heading is "Your run" for the author, their name for
  anyone else.
  */
  viewerId: string | undefined;
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  shouldPromptVerdict: boolean;
  recordPrompted: (input: { data: { entryId: string } }) => Promise<unknown>;
  toggleUseful: ToggleUsefulFn;
  /**
   * W1's report control, composed by the route — a node rather than a
   * callback, because this module may not import `modules/safety`: its
   * barrel reaches D1, and a component importing it puts the drizzle
   * schema in the client bundle (docs/architecture.md, "Composing across
   * modules"). Lane 124 owns the control; this screen owns where it sits.
   */
  reportAffordance?: ReactNode;
}

export function EntryDetail(props: Readonly<EntryDetailProps>) {
  const {
    entry,
    viewerId,
    shouldPromptVerdict,
    recordPrompted,
    toggleUseful,
    units,
    reportAffordance,
  } = props;
  // `entry.id` rather than an `entryId` prop beside it: two sources for one
  // fact is how a route comes to disagree with itself.
  const entryId = entry.id;
  const [status, setStatus] = useState("");
  // "Prompt once on next open, then never again" (packet A3): the prompt
  // showing at all — not the runner acting on it — spends the budget.
  useEffect(() => {
    if (shouldPromptVerdict) void recordPrompted({ data: { entryId } });
  }, [shouldPromptVerdict, entryId, recordPrompted]);

  const isOwn = viewerId === entry.userId;

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-4 px-5 pt-6 wide:mx-0">
      <FormStatus>{status}</FormStatus>
      <div className="flex items-center gap-3">
        <Link
          to="/feed"
          aria-label="Back to feed"
          className="target inline-flex items-center justify-center text-ink"
        >
          <Icon name="back" size={20} />
        </Link>
        <h1 className="m-0 font-display text-heading">
          {isOwn ? "Your run" : (entry.authorDisplayName ?? "A runner")}
        </h1>
      </div>

      <PhotoPager photoKeys={entry.photoKeys} />

      <RunStrip entry={entry} units={units} showBadge={!shouldPromptVerdict} />

      {shouldPromptVerdict ? (
        <Link
          data-part="verdict-prompt"
          to="/feed/verdict/$entryId"
          params={{ entryId }}
          className="target flex flex-col items-start gap-3 rounded-none border border-teal bg-dialed-tint p-4 text-ink no-underline"
        >
          <span className="text-body font-semibold">
            You didn&rsquo;t log a verdict for this run. Add one?
          </span>
          <span className="rounded-pill bg-ink px-5 py-3 text-body font-bold text-ground">
            Did it work?
          </span>
        </Link>
      ) : undefined}

      {entry.caption === undefined ? undefined : (
        <p data-part="note" className="m-0 text-body">
          {entry.caption}
        </p>
      )}

      <Kit items={entry.items} />

      <Tags tags={tagsOf(entry.tags)} />

      {/* Not on your own run (round 22, "D Sparse own entry"): Useful is
          what other runners say about it. So is Report. */}
      {isOwn ? undefined : (
        <UsefulButton
          entryId={entryId}
          usefulCount={entry.usefulCount}
          viewerHasReacted={entry.viewerHasReacted}
          toggleUseful={toggleUseful}
          onStatus={setStatus}
        />
      )}

      <ReportFoot>{isOwn ? undefined : reportAffordance}</ReportFoot>
    </div>
  );
}

/**
 * The entry's tags in A3's words, read-only. A stored string is one of
 * A3's tags only once it parses as one; anything else is dropped rather
 * than shown as a word nobody chose.
 */
function tagsOf(stored: readonly string[]): EntryTag[] {
  return stored.flatMap((tag) => {
    const parsed = entryTagSchema.safeParse(tag);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The photos, one at a time: a scroll-snapping row a thumb swipes, each
 * photo carrying its own `1 / 2`. Absent with no photos.
 */
function PhotoPager({ photoKeys }: Readonly<{ photoKeys: readonly string[] }>) {
  if (photoKeys.length === 0) return;
  return (
    <ul
      data-part="photo"
      className="m-0 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto p-0"
    >
      {photoKeys.map((key, index) => (
        <li key={key} className="relative w-full shrink-0 snap-start">
          <img
            src={`/feed/photo/${key}`}
            alt=""
            className="aspect-4/3 w-full rounded-card object-cover"
          />
          <span className="absolute bottom-3 left-3 rounded-tight bg-ground px-2 py-1 text-label">
            <Mono step="xs">
              {String(index + 1)} / {String(photoKeys.length)}
            </Mono>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The run itself — when, how far, how fast, the verdict, the conditions.
 * The one part every entry has. With no conditions the line is absent
 * (or `Indoor`); with no verdict the badge is.
 */
function RunStrip({
  entry,
  units,
  showBadge,
}: Readonly<{ entry: Entry; units: Units; showBadge: boolean }>) {
  const conditions = stripConditions(entry.conditions, entry.indoor, units);
  const pace = formatPace(entry.durationS, entry.distanceM, units.distance);
  return (
    <div
      data-part="run-strip"
      className="flex flex-col gap-2 border-b border-hairline pb-4"
    >
      <Mono step="xs" className="text-muted">
        {runWhenLabel(entry.startedAt, entry.conditions?.timeZone)}
      </Mono>
      <div className="flex flex-wrap items-baseline gap-3">
        <Mono step="lg">{formatDistance(entry.distanceM, units.distance)}</Mono>
        {pace === undefined ? undefined : (
          <Mono className="text-quiet">{pace}</Mono>
        )}
        {showBadge ? <VerdictBadge verdict={entry.verdict} /> : undefined}
      </div>
      {conditions === undefined ? undefined : (
        <ConditionsCell cell={conditions} />
      )}
    </div>
  );
}

/**
 * The tags on the bar-track fill (`--tint`), so they read as words rather
 * than as something to tap. Absent with none.
 */
function Tags({ tags }: Readonly<{ tags: readonly EntryTag[] }>) {
  if (tags.length === 0) return;
  return (
    <ul data-part="tags" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {tags.map((tag) => (
        <li key={tag} className="rounded-pill bg-tint px-2 py-1 text-quiet">
          <Mono step="xs">{tagLabel(tag)}</Mono>
        </li>
      ))}
    </ul>
  );
}

/**
 * The kit as a list, not chips, so a flag can sit at the row's end.
 * Absent when nothing was worn.
 */
function Kit({ items }: Readonly<{ items: Entry["items"] }>) {
  if (items.length === 0) return;
  return (
    <div data-part="kit" className="flex flex-col gap-2">
      <Mono step="xs" className="text-muted">
        Kit
      </Mono>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => (
          <li
            key={item.itemId}
            className="flex items-center justify-between gap-3 text-body"
          >
            {/* No brand is what generic means here: a piece nobody has
                named — the tap-list's "L/S crew" — which D marks
                `[GENERIC]` (round 22), as the closet's own label does
                (`garmentLabel`: brand and name, unless there is no brand). */}
            {item.brand === undefined ? (
              <span className="flex items-baseline gap-2">
                {item.name}
                <Mono step="xs" className="text-label">
                  [Generic]
                </Mono>
              </span>
            ) : (
              <span>{`${item.brand} ${item.name}`}</span>
            )}
            {item.flag === undefined ? undefined : (
              <Mono step="xs" className="font-semibold text-ink">
                {FLAG_MARK[item.flag]}
              </Mono>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
