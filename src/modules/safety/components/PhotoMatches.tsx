import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import { Bracketed, Mono } from "../../../ui";
import {
  garmentMatchActionInput,
  type GarmentMatchActionValues,
} from "../inputs";
import type { PhotoMatch, PhotoMatches as Found } from "../photo-matches";
import type { RemovedMatch } from "../removed-fingerprints";
import { PhotoSection } from "./OtherPhotos";
import { RemovalDecision } from "./RemovalDecision";
import { useFocusWhen } from "./use-focus-when";
import { useSettled } from "./use-settled";

/**
 * Photos from any runner, private included, that match a reported one by
 * fingerprint (D-142, design 146), on the Review rows that list the
 * runner's other photos: the hashed half of the effort on copies.
 *
 * **As round 39 #71 rules**: a grid of its own under THEIR OTHER PHOTOS,
 * headed MATCHING PHOTOS · ANY RUNNER · N, nearest first. Under each
 * photo: its id, which the takedown form under Review takes (a garment's
 * named as one); its distance, "{N} bits" or "same", with [private] for a
 * kit not shared; and its owner's @handle, opening them in D8. A kit photo
 * links its kit when an operator can open it; a garment photo is never
 * shown to another runner, so its tile opens nothing and offers Decide,
 * which opens its takedown under the grid (design 159, round 42 #89). Each
 * photo is served from `/safety/review-photo/`.
 *
 * Nothing renders on a row that does not search (`undefined`). A subject
 * with no fingerprint says so rather than "no matches", which would be a
 * claim the search never made; an empty state's kicker has no count.
 */
export function PhotoMatches({
  found,
  decide,
}: Readonly<{
  found: Found | undefined;
  decide?: DecideMatch | undefined;
}>): JSX.Element | undefined {
  if (found === undefined) return undefined;
  return <FoundMatches found={found} decide={decide} />;
}

/**
 * Takes down a garment photo copy search found (R-167, design 159): the
 * server function's own shape, handed down from the route.
 */
export type DecideMatch = (input: {
  data: GarmentMatchActionValues;
}) => Promise<unknown>;

function matchKey(match: PhotoMatch): string {
  return match.photoKey;
}

/**
 * The search's answer, headed with how many it found that are still here:
 * a garment match taken down leaves the grid, as a decided Review row does
 * (`useSettled`), and the count drops with it (round 42 #89).
 */
function FoundMatches({
  found,
  decide,
}: Readonly<{
  found: Found;
  decide: DecideMatch | undefined;
}>): JSX.Element {
  const { remaining, settle } = useSettled(found.matches, matchKey);
  const deciding = useGarmentDeciding(remaining, settle);
  return (
    <PhotoSection
      part="photo-matches"
      title={
        found.matches.length === 0
          ? "Matching photos · any runner"
          : `Matching photos · any runner · ${String(remaining.length)}`
      }
      titleRef={deciding.kickerRef}
    >
      <Matches
        found={found}
        remaining={remaining}
        decide={decide}
        deciding={deciding}
      />
      <DecideBar deciding={deciding} />
    </PhotoSection>
  );
}

/**
 * Which garment tile's bar is open — one at a time, with the takedown its
 * Decide was handed — and where focus goes once one is decided: the next
 * garment tile's Decide (the one before, after the last), or, with none
 * left, the MATCHING PHOTOS kicker (round 42 #89). A decided tile leaves
 * `remaining`, so its bar closes with it.
 */
function useGarmentDeciding(
  remaining: readonly PhotoMatch[],
  settle: (key: string) => void,
) {
  const [opened, setOpened] = useState<
    { readonly key: string; readonly decide: DecideMatch } | undefined
  >();
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const [isKickerNext, setIsKickerNext] = useState(false);
  const garments = remaining.filter((match) => match.kind === "garment");
  const [open] = garments.flatMap((match) =>
    opened?.key === match.photoKey ? [{ match, decide: opened.decide }] : [],
  );
  return {
    open,
    focusKey,
    kickerRef: useFocusWhen(isKickerNext),
    toggle: (key: string, decide: DecideMatch): void => {
      setOpened((current) =>
        current?.key === key ? undefined : { key, decide },
      );
    },
    decided: (key: string): void => {
      const at = garments.findIndex((match) => match.photoKey === key);
      const next = garments[at + 1] ?? garments[at - 1];
      settle(key);
      if (next === undefined) setIsKickerNext(true);
      else setFocusKey(next.photoKey);
    },
  };
}

type GarmentDeciding = ReturnType<typeof useGarmentDeciding>;

// A garment tile while its bar is open: §06's focus ring, so it is clear
// which photo the bar acts on. Written out whole, so it reads as one list.
const OPEN_TILE_CLASS =
  "flex flex-col gap-1 outline outline-2 outline-offset-2 outline-ink";
const TILE_CLASS = "flex flex-col gap-1";

/**
 * The grid, or the sentence that stands in for it.
 */
function Matches({
  found,
  remaining,
  decide,
  deciding,
}: Readonly<{
  found: Found;
  remaining: readonly PhotoMatch[];
  decide: DecideMatch | undefined;
  deciding: GarmentDeciding;
}>): JSX.Element {
  if (!found.fingerprinted) {
    return (
      <span className="text-micro text-quiet">
        No fingerprint to match by: the photo is gone, or older than
        fingerprints.
      </span>
    );
  }
  if (found.matches.length === 0) {
    return (
      <span className="text-micro text-quiet">
        No matching photos from any runner.
      </span>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
      {remaining.map((match) => (
        <li
          key={match.photoKey}
          className={
            deciding.open?.match.photoKey === match.photoKey
              ? OPEN_TILE_CLASS
              : TILE_CLASS
          }
        >
          <Thumbnail match={match} />
          <span className="text-quiet">
            <Mono step="xs">{nameOf(match)}</Mono>
          </span>
          <span data-part="match-distance" className="text-quiet uppercase">
            <Mono step="xs">{distanceLabel(match.distance)}</Mono>
            {match.isPrivate ? (
              <>
                {" · "}
                <Bracketed>private</Bracketed>
              </>
            ) : undefined}
          </span>
          <Owner handle={match.handle} />
          {decide !== undefined && match.kind === "garment" ? (
            <DecideLink match={match} decide={decide} deciding={deciding} />
          ) : undefined}
        </li>
      ))}
    </ul>
  );
}

/**
 * The bar's id, for the Decide that opens it: one bar under the grid.
 */
function barId(match: PhotoMatch): string {
  return `decide-${match.id}`;
}

/**
 * A garment tile's one control (round 42 #89): "Decide", 44 high, at the
 * tile's foot, reading "Close" while its bar is open. A kit tile has none:
 * a kit match is acted on from its kit's page.
 */
function DecideLink({
  match,
  decide,
  deciding,
}: Readonly<{
  match: PhotoMatch;
  decide: DecideMatch;
  deciding: GarmentDeciding;
}>): JSX.Element {
  const isOpen = deciding.open?.match.photoKey === match.photoKey;
  const ref = useFocusWhen(deciding.focusKey === match.photoKey);
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={isOpen}
      aria-controls={isOpen ? barId(match) : undefined}
      onClick={() => {
        deciding.toggle(match.photoKey, decide);
      }}
      className="target cursor-pointer self-start border-none bg-transparent p-0 text-body text-ink underline underline-offset-4"
    >
      {isOpen ? "Close" : "Decide"}
    </button>
  );
}

/**
 * The open garment tile's bar, full width under the grid (round 42 #89):
 * the kicker naming which photo and whose, then the bar a garment row on
 * Review has without Approve — nothing queued a match — so the reason,
 * Remove (which tells its owner) and Remove as suspected CSAM (which
 * tells nobody), its question in place.
 */
function DecideBar({
  deciding,
}: Readonly<{ deciding: GarmentDeciding }>): JSX.Element | undefined {
  if (deciding.open === undefined) return undefined;
  const { match: open, decide } = deciding.open;
  const owner = open.handle === undefined ? "" : ` · @${open.handle}`;
  return (
    <div
      id={barId(open)}
      data-part="decide-bar"
      className="flex w-full flex-col gap-2 border-t border-hairline pt-3"
    >
      <span className="text-label">
        <Mono step="xs">{`Decide · garment photo · ${open.id}${owner}`}</Mono>
      </span>
      <RemovalDecision
        key={open.photoKey}
        schema={garmentMatchActionInput}
        subject={{ itemId: open.id }}
        act={(values) => decide({ data: values })}
        canApprove={false}
        subjectType="garment"
        owner={open.handle}
        onSettled={() => {
          deciding.decided(open.photoKey);
        }}
      />
    </div>
  );
}

/**
How near, as the tile says it: "same" at 0, the bits otherwise.
*/
function distanceLabel(distance: number): string {
  return distance === 0 ? "same" : bitsLabel(distance);
}

/**
 * Whose the photo is: their @handle, opening them in D8. A runner with no
 * handle cannot be searched for there, so nothing is offered.
 */
function Owner({
  handle,
}: Readonly<{ handle: string | undefined }>): JSX.Element | undefined {
  if (handle === undefined) return undefined;
  return (
    <Link
      data-part="match-owner"
      to="/desk/runners"
      search={{ query: handle, filter: "all" }}
      className="target self-start text-ink"
    >
      <Mono step="xs">{`@${handle}`}</Mono>
    </Link>
  );
}

/**
A kit photo by its id, which the takedown form takes; a garment as one.
*/
function nameOf(match: PhotoMatch): string {
  return match.kind === "garment" ? `Garment ${match.id}` : match.id;
}

/**
 * What the image is called: which photo, how near, and whether it opens
 * anything — so a list of them is not one name read over and over.
 */
function altOf(match: PhotoMatch): string {
  const near = `${nameOf(match)}, ${String(match.distance)} bits from the reported photo`;
  return match.canOpen ? `${near}: open its kit` : near;
}

/**
One match: a link to its kit when the operator can open it, the image alone when not.
*/
function Thumbnail({ match }: Readonly<{ match: PhotoMatch }>): JSX.Element {
  const image = (
    <img
      src={`/safety/review-photo/${match.photoKey}`}
      alt={altOf(match)}
      className="h-32 w-auto border border-hairline"
    />
  );
  if (!match.canOpen) return image;
  return (
    <Link
      to="/feed/entry/$entryId"
      params={{ entryId: match.entryId }}
      className="target self-start"
    >
      {image}
    </Link>
  );
}

/**
 * Why a fingerprint row is here (D-147, design 152): the photo is a copy
 * of an image removed as intimate, removed on this day, this many bits
 * apart. The removed image itself is gone, so there is nothing to show
 * beside it but the facts.
 *
 * **Undesigned** (design deltas item 84): one line of text and mono, as
 * the handle-flagged row's "why here" line is. Nothing renders on any
 * other row.
 */
export function RemovedMatchLine({
  match,
}: Readonly<{ match: RemovedMatch | undefined }>): JSX.Element | undefined {
  if (match === undefined) return undefined;
  return (
    <p data-part="removed-match" className="m-0 text-body">
      A copy of an image removed as intimate on{" "}
      <Mono step="xs">{monthDayLabel(match.removedAt)}</Mono>,{" "}
      <Mono step="xs">{bitsLabel(match.distance)}</Mono> apart.
    </p>
  );
}

/**
A distance as the line says it: "1 bit", "0 bits", "3 bits".
*/
function bitsLabel(distance: number): string {
  return distance === 1 ? "1 bit" : `${String(distance)} bits`;
}
