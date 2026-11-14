import { Link } from "@tanstack/react-router";

import type { Units } from "../../../lib/contracts";
import {
  CREDIT_LABEL,
  GarminAttribution,
  Mono,
  SlowLabel,
  useTappedSlow,
  WeatherAttribution,
} from "../../../ui";
import type { FeedItem } from "../feed";
import { BOUND_SEPARATOR, postedLabel } from "../posted";
import { isProvidersReading, stripConditions } from "../strip";
import { Avatar } from "./Avatar";
import { Handle, handleText } from "./Handle";
import { UnderReview } from "./UnderReview";
import { ConditionsCell } from "./ConditionsCell";
import { PhotoCounter, PhotoSlot } from "./PhotoSlot";

import { UsefulButton } from "./UsefulButton";
import type { SetUsefulFn } from "./useful-reaction";
import { SpokenDistance } from "./SpokenDistance";
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
 * own shared entries among everyone else's. Its "·" is bound to "You"
 * (R55·204), so "You" never sits alone on a line.
 */
const OWN_SUFFIX = `${BOUND_SEPARATOR}You`;

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
  const isCredited = isProvidersReading(item.conditions);

  return (
    <article
      data-part="post"
      data-state={photo === undefined ? "no-photo" : "with-photo"}
      // R55·205: 16 above and below, and the column's gutter inside the
      // post, so Feed's --tint band between posts runs edge to edge.
      className="flex flex-col gap-3 px-5 py-4 wide:px-6"
    >
      {/* The credit is a link of its own, so it cannot sit inside the
          card's: it lies over the strip's right end (Round 54 · 170), and
          the strip keeps that end clear with an unseen copy of its words.
          The strip is the link's last part, so the two share a bottom. */}
      <div className="relative">
        <Link
          to="/feed/entry/$entryId"
          params={{ entryId: item.entryId }}
          onClick={onClick}
          className="target flex flex-col gap-3 text-ink no-underline"
        >
          {/* R55·204–205: the avatar and the tag and badge centre on the
              handle's line, and the meta wraps under the handle as a
              whole, so a long one never pushes them down. */}
          <div data-part="author" className="flex items-start gap-3">
            <span className="-my-2 shrink-0">
              <Avatar name={item.authorUsername ?? "A runner"} size="small" />
            </span>
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
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              {item.underReview ? <UnderReview /> : undefined}
              <VerdictBadge verdict={item.verdict} />
            </span>
          </div>
          {photo === undefined ? undefined : (
            // The first photo at 4:5, carrying only its `1 / N` counter,
            // bottom right (R55·207): the rest are D's pager.
            <PhotoSlot
              src={`/feed/photo/${photo}`}
              shape="portrait"
              overlay={<PhotoCounter index={0} count={item.photoKeys.length} />}
            />
          )}
          <div
            data-part="run-strip"
            className="flex min-h-target items-center gap-3 border-y border-hairline whitespace-nowrap"
          >
            {/* Drawn as "8.1 MI", with the space the Feed board draws
                (E1-08); said "8.1 miles" (round 52 #158). */}
            <Mono className="shrink-0">
              <SpokenDistance distanceM={item.distanceM} units={units} />
            </Mono>
            {second === undefined ? undefined : (
              <>
                {/* A rule between two cells, not a value: nothing to read.
                    The board's "|", in the strip's mono and centred on its
                    line, not a body-size sans one below it (E1-08). */}
                <span aria-hidden="true" className="shrink-0 text-hairline">
                  <Mono>|</Mono>
                </span>
                {/* At 320 the sky word truncates before the credit wraps
                    (Round 54 · 170). */}
                <span className="min-w-0 truncate">
                  <ConditionsCell cell={second} />
                </span>
              </>
            )}
            {isCredited ? (
              // The room the strip keeps for the credit lying over its end:
              // the label's own words, in its own step, never seen.
              <Mono step="xs" className="invisible ml-auto shrink-0">
                {CREDIT_LABEL}
              </Mono>
            ) : undefined}
          </div>
        </Link>
        {/* Visual Crossing's licence asks for the credit near the data
          (FEED-8), so every card with the provider's reading carries it:
          on the card the label, heard by the sentence (Round 54 · 170).
          After the list's first, it is drawn and not heard (R-179). An
          indoor run, or one with no conditions, has no credit. */}
        {isCredited ? (
          <span className="absolute right-0 bottom-0 flex min-h-target items-center">
            <WeatherAttribution isCompact isRepeat={isCreditRepeated} />
          </span>
        ) : undefined}
      </div>
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
