import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { verdictLabel } from "../../../lib/contracts";
import type { Units } from "../../../lib/contracts";
import {
  formatDistance,
  formatDuration,
  formatTempRange,
} from "../../../lib/measures";
import {
  Bracketed,
  ControlFailureBand,
  Digits,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  useControlAction,
} from "../../../ui";
import type { entryDetailForViewer } from "../entries";
import { ListSection } from "../../../ui";

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
/**
 * "The kit · 3 pieces", as board D heads the list (round 19). It was
 * "Kit", with no count. One piece is "piece": the board only ever draws
 * three, and "1 pieces" is the kind of slip a count invites.
 */
function kitTitle(count: number): string {
  return `The kit · ${String(count)} ${count === 1 ? "piece" : "pieces"}`;
}

export function EntryDetail({
  entry,
  shouldPromptVerdict,
  recordPrompted,
  toggleUseful,
  units,
  reportAffordance,
}: Readonly<{
  entry: Entry;
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  shouldPromptVerdict: boolean;
  recordPrompted: (input: { data: { entryId: string } }) => Promise<unknown>;
  toggleUseful: (input: {
    data: { entryId: string };
  }) => Promise<{ useful: boolean }>;
  /**
   * W1's report control, composed by the route.
   *
   * A node rather than a callback, because this module may not import
   * `modules/safety` — dependency-cruiser forbids a cross-module deep
   * import and the safety barrel reaches D1, which a component in the
   * client bundle cannot. So this screen renders whatever it is handed
   * and does not know what a report is.
   *
   * **Asked on PR #73: is this a problem, and should the rules bend?**
   * No, on the evidence. A callback would not help — the thing feed must
   * not import is not the *function*, it is the sheet, its reason list and
   * its copy, all of which live in `modules/safety/components` and all of
   * which a callback would still have to render from here. The node IS
   * the seam, and it is the one the architecture already prescribes:
   * routes wire, components take props. The rule is also load-bearing
   * rather than tidy — the safety barrel reaches D1, and a component
   * importing it puts the drizzle schema in the client bundle, which is
   * invisible to tsc, eslint, dependency-cruiser and the test suite alike
   * (CLAUDE.md §Architecture records two live instances, one of which did
   * not even fail the build).
   *
   * What would be worth changing is not the rule but its discoverability:
   * this is the first cross-lane composition seam in the app, and the next
   * lane that needs one will re-derive it from scratch. Written up in
   * `docs/architecture.md` §"Composing across modules" for that reason.
   */
  reportAffordance?: ReactNode;
}>) {
  // `entry.id` rather than an `entryId` prop beside it. The component
  // took both, which is two sources for one fact — and the kind a route
  // can silently disagree with itself about, since one came from the URL
  // params and the other from the loader.
  const entryId = entry.id;
  const [useful, setUseful] = useState({
    count: entry.usefulCount,
    reacted: entry.viewerHasReacted,
  });
  // Round 23, item 9: Useful waits for the server behind `[ Noting ]` and
  // the count changes on success only. It was never optimistic, but its
  // failure was silent — a `finally` with no `catch`, so a dropped
  // connection looked exactly like a press that had not registered.
  const markUseful = useControlAction({
    action: async () => {
      const result = await toggleUseful({ data: { entryId } });
      setUseful((previous) => ({
        count: result.useful ? previous.count + 1 : previous.count - 1,
        reacted: result.useful,
      }));
    },
    // The state still true when the press fails is the one it tried to
    // leave (§4a names "Not marked" for Useful; un-marking fails the other
    // way round).
    kicker: useful.reacted ? "Still marked" : "Not marked",
  });
  // "Prompt once on next open, then never again" (packet A3): the prompt
  // showing at all — not the user acting on it — spends the one-time
  // budget.
  useEffect(() => {
    if (shouldPromptVerdict) void recordPrompted({ data: { entryId } });
  }, [shouldPromptVerdict, entryId, recordPrompted]);


  return (
    <div className="mx-auto flex w-full max-w-column wide:mx-0 flex-col gap-6 px-5 pt-6">
      {shouldPromptVerdict ? (
        <Link
          to="/feed/verdict/$entryId"
          params={{ entryId }}
          className="target flex items-center justify-between rounded-card border border-teal bg-dialed-tint px-4 py-3 text-body font-semibold text-ink no-underline"
        >
          You didn&rsquo;t log a verdict for this run. Add one?
        </Link>
      ) : undefined}

      <div className="flex items-center justify-between">
        <h1 className="font-display text-title uppercase">{entry.runTitle}</h1>
        {entry.verdict === undefined ? undefined : (
          <Bracketed className="text-dialed-text">
            {verdictLabel(entry.verdict) ?? "Dialed"}
          </Bracketed>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Mono step="md" className="text-quiet">
          {formatDistance(entry.distanceM, units.distance)} ·{" "}
          {formatDuration(entry.durationS)}
        </Mono>
        {entry.conditions === undefined ? undefined : (
          <Mono step="md" className="text-dialed-text">
            {formatTempRange(
              entry.conditions.span.minTempC,
              entry.conditions.span.maxTempC,
              units.temp,
            )}{" "}
            {entry.conditions.condition}
          </Mono>
        )}
      </div>

      <p className="m-0 text-small text-quiet">
        {entry.authorDisplayName ?? "A runner"}
      </p>

      {reportAffordance}

      {entry.photoKeys.length === 0 ? undefined : (
        <div className="grid grid-cols-2 gap-2">
          {entry.photoKeys.map((key) => (
            <img
              key={key}
              src={`/feed/photo/${key}`}
              alt=""
              className="aspect-square w-full rounded-field object-cover"
            />
          ))}
        </div>
      )}

      {entry.caption === undefined ? undefined : (
        <p className="m-0 text-body">{entry.caption}</p>
      )}

      <ListSection title={kitTitle(entry.items.length)} items={entry.items}>
        {(item) => (
          <li
            key={item.itemId}
            className="flex items-center justify-between text-body"
          >
            <span>
              {item.brand === undefined ? "" : `${item.brand} `}
              {item.name}
            </span>
            {item.flag === undefined ? undefined : (
              <Bracketed className="text-muted">
                {item.flag.replaceAll("_", " ")}
              </Bracketed>
            )}
          </li>
        )}
      </ListSection>

      {entry.tags.length === 0 ? undefined : (
        <div className="flex flex-wrap gap-2">
          {entry.tags.map((tag) => (
            <Bracketed key={tag} className="text-muted">
              {tag.replaceAll("_", " ")}
            </Bracketed>
          ))}
        </div>
      )}

      <button
        type="button"
        {...inFlight(markUseful.pending)}
        onClick={() => {
          void markUseful.run();
        }}
        className={
          useful.reacted
            ? "target self-start rounded-pill bg-teal px-4 py-2 text-body font-semibold text-ink"
            : "target self-start rounded-pill border border-hairline px-4 py-2 text-body font-semibold"
        }
      >
        {/* The count travels with the label rather than sitting beside it,
            so the whole thing swaps for `[ Noting ]` — a rolling counter
            next to a pending verb would be two states at once. */}
        <PendingLabel
          pending={markUseful.pending}
          pendingLabel="Noting"
          label={
            <>
              Useful{" "}
              <Mono className="ml-1">
                [<Digits value={useful.count} />]
              </Mono>
            </>
          }
        />
      </button>
      {/* Directly under the control that failed, full content width —
          never beside the pill, which is too narrow for a sentence and a
          button (§4a). */}
      <ControlFailureBand
        failure={markUseful.failure}
        onRetry={markUseful.retry}
        retryRef={markUseful.retryRef}
      />
      <FormStatus>{markUseful.status}</FormStatus>

      <Link
        to="/feed"
        className="target inline-flex items-center text-body font-semibold text-cold-text"
      >
        Back to feed
      </Link>
    </div>
  );
}
