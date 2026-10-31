import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import { Bracketed, Mono } from "../../../ui";
import {
  garmentMatchActionInput,
  type GarmentMatchActionValues,
} from "../inputs";
import type { PhotoMatch, PhotoMatches as Found } from "../photo-matches";
import type { RemovedImage, RemovedMatch } from "../removed-fingerprints";
import { PhotoSection } from "./OtherPhotos";
import { RemovalDecision } from "./RemovalDecision";
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
 * shown to another runner, so its tile opens nothing and carries its own
 * takedown instead (design 159). Each photo is served from
 * `/safety/review-photo/`.
 *
 * **Removed images come first** (round 41 #84, round 42), on a row held
 * on upload: one tile for each image removed as intimate within the match
 * distance, nearest first. The image is never shown again, so the tile is
 * an empty hairline frame reading REMOVED, with the photo's id, "{N} BITS
 * · REMOVED {date}" and its owner. They count toward N.
 *
 * Nothing renders on a row that does not search (`undefined`). A subject
 * with no fingerprint says so rather than "no matches", which would be a
 * claim the search never made; an empty state's kicker has no count.
 */
export function PhotoMatches({
  found,
  removed = [],
  decide,
}: Readonly<{
  found: Found | undefined;
  removed?: readonly RemovedImage[] | undefined;
  decide?: DecideMatch | undefined;
}>): JSX.Element | undefined {
  if (found === undefined) return undefined;
  const count = removed.length + found.matches.length;
  return (
    <PhotoSection
      part="photo-matches"
      title={
        count === 0
          ? "Matching photos · any runner"
          : `Matching photos · any runner · ${String(count)}`
      }
    >
      <Matches found={found} removed={removed} decide={decide} />
    </PhotoSection>
  );
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
 * The list, or the sentence that stands in for it. A garment match taken
 * down leaves it, as a decided Review row does (`useSettled`).
 */
function Matches({
  found,
  removed,
  decide,
}: Readonly<{
  found: Found;
  removed: readonly RemovedImage[];
  decide: DecideMatch | undefined;
}>): JSX.Element {
  const { remaining, settle } = useSettled(found.matches, matchKey);
  if (!found.fingerprinted) {
    return (
      <span className="text-micro text-quiet">
        No fingerprint to match by: the photo is gone, or older than
        fingerprints.
      </span>
    );
  }
  if (removed.length + found.matches.length === 0) {
    return (
      <span className="text-micro text-quiet">
        No matching photos from any runner.
      </span>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
      {removed.map((image) => (
        <RemovedTile key={image.keptId} image={image} />
      ))}
      {remaining.map((match) => (
        <li key={match.photoKey} className="flex flex-col gap-1">
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
          <GarmentDecision
            match={match}
            decide={decide}
            onSettled={() => {
              settle(match.photoKey);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * An image removed as intimate (round 41 #84): never shown again, so an
 * empty frame the photos' size, reading REMOVED, then which photo it was,
 * how near and when it went, and whose. Nothing opens from it: there is no
 * kit to open and nothing left to take down.
 */
function RemovedTile({
  image,
}: Readonly<{ image: RemovedImage }>): JSX.Element {
  return (
    <li data-part="removed-tile" className="flex flex-col gap-1">
      <span className="flex h-32 w-32 items-center justify-center border border-hairline text-quiet">
        <Mono step="xs">Removed</Mono>
      </span>
      <span className="text-quiet">
        <Mono step="xs">{nameOf(image)}</Mono>
      </span>
      <span className="text-quiet">
        <Mono step="xs">
          {`${bitsLabel(image.distance)} · removed ${monthDayLabel(image.removedAt)}`}
        </Mono>
      </span>
      <Owner handle={image.handle} />
    </li>
  );
}

/**
 * A garment match's takedown (R-167, design 159): a kit match is acted on
 * from its kit's page, but a garment has no page, so its tile carries the
 * bar a garment row on Review has — the reason, Remove (which tells its
 * owner) and Remove as suspected CSAM (which tells nobody) — with no
 * Approve, since nothing queued it. Nothing for a kit match, or where no
 * takedown was handed down.
 */
function GarmentDecision({
  match,
  decide,
  onSettled,
}: Readonly<{
  match: PhotoMatch;
  decide: DecideMatch | undefined;
  onSettled: () => void;
}>): JSX.Element | undefined {
  if (decide === undefined || match.kind !== "garment") return undefined;
  return (
    <RemovalDecision
      schema={garmentMatchActionInput}
      subject={{ itemId: match.id }}
      act={(values) => decide({ data: values })}
      subjectType="garment"
      owner={match.handle}
      onSettled={onSettled}
    />
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
function nameOf(match: Pick<PhotoMatch, "kind" | "id">): string {
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
 * Why a held-on-upload row is here (D-147, round 41 #84): the photo is a
 * close match to an image removed as intimate, removed on this day, this
 * many bits apart — or the same image, at 0. "Copy" is not said: a match
 * within 8 bits is a likeness, and the operator decides. Date and distance
 * in MONO.xs, BODY otherwise, under the row's photo. Nothing renders on
 * any other row.
 */
export function RemovedMatchLine({
  match,
}: Readonly<{ match: RemovedMatch | undefined }>): JSX.Element | undefined {
  if (match === undefined) return undefined;
  const removed = <Mono step="xs">{monthDayLabel(match.removedAt)}</Mono>;
  return (
    <p data-part="removed-match" className="m-0 text-body">
      {match.distance === 0 ? (
        <>The same image as one removed as intimate on {removed}.</>
      ) : (
        <>
          A close match to an image removed as intimate on {removed},{" "}
          <Mono step="xs">{bitsLabel(match.distance)}</Mono> apart.
        </>
      )}
    </p>
  );
}

/**
A distance as the line says it: "1 bit", "0 bits", "3 bits".
*/
function bitsLabel(distance: number): string {
  return distance === 1 ? "1 bit" : `${String(distance)} bits`;
}
