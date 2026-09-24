import { Link } from "@tanstack/react-router";

import type { Units } from "../../../lib/contracts";
import { formatDistance } from "../../../lib/measures";
import { Mono } from "../../../ui";
import type { FeedItem } from "../feed";
import { postedLabel } from "../posted";
import { stripConditions } from "../strip";
import { Avatar } from "./Avatar";
import { ConditionsCell } from "./ConditionsCell";
import { UsefulButton } from "./UsefulButton";
import type { ToggleUsefulFn } from "./useful-reaction";
import { VerdictBadge } from "./VerdictBadge";

/**
 * One post on Following — the v1 card (round 22, "E1v1 Following").
 *
 * **The order is fixed**: author and badge, photo, caption, strip, Useful.
 * Kit and pace left the card for D. **A missing part is absent, never a
 * placeholder**: no photo, no caption, no badge are all whole posts, and
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
  toggleUseful: ToggleUsefulFn;
  onStatus: (status: string) => void;
}

export function PostCard(props: Readonly<PostCardProps>) {
  const { item, units, now, toggleUseful, onStatus } = props;
  const name = item.authorDisplayName ?? "A runner";
  const [photo] = item.photoKeys;
  const second = stripConditions(item.conditions, item.indoor, units);

  return (
    <article
      data-part="post"
      data-state={photo === undefined ? "no-photo" : "with-photo"}
      className="flex flex-col gap-3 border-b border-hairline pb-5"
    >
      <Link
        to="/feed/entry/$entryId"
        params={{ entryId: item.entryId }}
        className="target flex flex-col gap-3 text-ink no-underline"
      >
        <div data-part="author" className="flex items-center gap-3">
          <Avatar name={name} size="small" />
          <span className="flex flex-1 flex-col">
            <span className="text-body font-semibold">{name}</span>
            <Mono step="xs" className="text-muted">
              {postedLabel(item.startedAt, now, item.conditions?.timeZone)}
            </Mono>
          </span>
          <VerdictBadge verdict={item.verdict} />
        </div>
        {photo === undefined ? undefined : (
          <img
            data-part="photo"
            src={`/feed/photo/${photo}`}
            alt=""
            className="aspect-video w-full rounded-card object-cover"
          />
        )}
        {item.caption === undefined ? undefined : (
          <p data-part="caption" className="m-0 text-body">
            {item.caption}
          </p>
        )}
        <div
          data-part="run-strip"
          className="flex gap-3 border-y border-hairline py-2"
        >
          <Mono>{formatDistance(item.distanceM, units.distance)}</Mono>
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
      <UsefulButton
        entryId={item.entryId}
        usefulCount={item.usefulCount}
        viewerHasReacted={item.viewerHasReacted}
        toggleUseful={toggleUseful}
        onStatus={onStatus}
      />
    </article>
  );
}
