import { Link } from "@tanstack/react-router";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import {
  GarminAttribution,
  Mono,
  SlowLabel,
  Spoken,
  useTappedSlow,
  WeatherAttribution,
} from "../../../ui";
import type { FeedItem } from "../feed";
import { postedLabel } from "../posted";
import { isProvidersReading, stripConditions } from "../strip";
import { Avatar } from "./Avatar";
import { Handle, handleText } from "./Handle";
import { UnderReview } from "./UnderReview";
import { ConditionsCell } from "./ConditionsCell";

import { UsefulButton } from "./UsefulButton";
import type { SetUsefulFn } from "./useful-reaction";
import { VerdictBadge } from "./VerdictBadge";

/**
 * One post on Following — the v1 card (round 22, "E1v1 Following").
 *
 * **The order is fixed**: author and badge, photo, strip, Useful. Kit
 * and pace left the card for D, and the caption is cut for v1 (D-167).
 * **A missing part is absent, never a placeholder**: no photo, no badge
 * are whole posts, and
 * the strip is the one part every post has.
 *
 * Everything above Useful is one link to D; Useful is its own control, so
 * it cannot sit inside the link.
 */
export interface PostCardProps {
  item: FeedItem;
  units: Units;
  /**
  The loader's clock, so the server and the browser say the same "2h ago".
  */
  now: number;
  setUseful: SetUsefulFn;
  onStatus: (status: string) => void;
  /**
   * Whether an earlier card in the list already credits Visual Crossing.
   * The list decides, because only it knows which card is first.
   */
  isCreditRepeated?: boolean;
}

/**
 * The viewer's own post says so after its time (the Feed board's "E1 Card
 * states": `SAT · 6:30 AM · YOU`), since Following carries the viewer's
 * own shared entries among everyone else's.
 */
const OWN_SUFFIX = " · You";

/**
 * Whose run a card's Useful is about, said after "Useful": twenty cards
 * are twenty Usefuls, and only this tells them apart.
 */
function whoseRun(item: FeedItem): string {
  if (item.isOwn) return "your run";
  return item.authorUsername === undefined
    ? "a runner’s run"
    : `${handleText(item.authorUsername)}’s run`;
}

export function PostCard(props: Readonly<PostCardProps>) {
  const {
    item,
    units,
    now,
    setUseful,
    onStatus,
    isCreditRepeated = false,
  } = props;
  const [photo] = item.photoKeys;
  const second = stripConditions(item.conditions, item.indoor, units);
  // X3 on a whole-card link: the date breathes, the handle stays still
  // (round 47 #122).
  const { isWaiting, onClick } = useTappedSlow();

  return (
    <article
      data-part="post"
      data-state={photo === undefined ? "no-photo" : "with-photo"}
      className="flex flex-col gap-3 py-4"
    >
      <Link
        to="/feed/entry/$entryId"
        params={{ entryId: item.entryId }}
        onClick={onClick}
        className="target flex flex-col gap-3 text-ink no-underline"
      >
        <div data-part="author" className="flex items-center gap-3">
          <Avatar name={item.authorUsername ?? "A runner"} size="small" />
          <span className="flex min-w-0 flex-1 flex-col wrap-anywhere">
            <span className="text-body">
              <Handle username={item.authorUsername} />
            </span>
            <Mono step="xs" className="text-muted">
              <SlowLabel
                label={postedLabel(
                  item.startedAt,
                  now,
                  item.conditions?.timeZone,
                )}
                isWaiting={isWaiting}
              />
              {item.isOwn ? OWN_SUFFIX : undefined}
            </Mono>
            <GarminAttribution deviceName={item.deviceName} />
          </span>
          <span className="flex items-center gap-2">
            {item.underReview ? <UnderReview /> : undefined}
            <VerdictBadge verdict={item.verdict} />
          </span>
        </div>
        {photo === undefined ? undefined : (
          // The first photo, carrying only its `1 / N` counter, bottom
          // right (the Feed board's E1): the rest are D's pager. A lone
          // photo carries no counter (round 35 #53c).
          <span className="relative block">
            <img
              data-part="photo"
              src={`/feed/photo/${photo}`}
              alt=""
              className="aspect-video w-full rounded-card object-cover"
            />
            {item.photoKeys.length > 1 ? (
              <span className="absolute right-3 bottom-3 rounded-tight bg-ground px-2 py-1 text-ink">
                <Mono step="xs">1 / {String(item.photoKeys.length)}</Mono>
              </span>
            ) : undefined}
          </span>
        )}
        <div
          data-part="run-strip"
          className="flex gap-3 border-y border-hairline py-2"
        >
          {/* Drawn as "8.2mi", said "8.2 miles" (round 52 #158). */}
          <Mono>
            <Spoken
              {...measuredLine(
                [[{ kind: "distance", distanceM: item.distanceM }]],
                units,
              )}
            />
          </Mono>
          {second === undefined ? undefined : (
            <>
              {/* A rule between two cells, not a value: nothing to read. */}
              <span aria-hidden="true" className="text-hairline">
                |
              </span>
              <ConditionsCell cell={second} />
            </>
          )}
        </div>
      </Link>
      {/* Outside the link, because it is a link of its own: Visual
          Crossing's licence asks for the credit near the data (FEED-8).
          Every card shows it, because the licence is about display; after
          the list's first, it is drawn and not heard (R-179). */}
      {isProvidersReading(item.conditions) ? (
        <WeatherAttribution isRepeat={isCreditRepeated} />
      ) : undefined}
      <UsefulButton
        entryId={item.entryId}
        usefulCount={item.usefulCount}
        viewerHasReacted={item.viewerHasReacted}
        setUseful={setUseful}
        onStatus={onStatus}
        whose={whoseRun(item)}
      />
    </article>
  );
}
