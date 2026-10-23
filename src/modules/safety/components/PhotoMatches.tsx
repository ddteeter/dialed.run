import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "../../../ui";
import type { PhotoMatch, PhotoMatches as Found } from "../photo-matches";
import { PhotoSection } from "./OtherPhotos";

/**
 * Photos from any runner, private included, that match a reported one by
 * fingerprint (D-142, design 146), on the Review rows that list the
 * runner's other photos: the hashed half of the effort on copies.
 *
 * **Undesigned** (design deltas item 66): existing primitives and text
 * only, laid out as "Their other photos" is. Each photo is served from
 * `/safety/review-photo/`, as the row's own are. A kit photo carries its
 * id, which the takedown form under Review takes, and links its kit when
 * an operator can open it; a garment photo is never shown to another
 * runner, so it has no page and is named as a garment.
 *
 * Nothing renders on a row that does not search (`undefined`). A subject
 * with no fingerprint says so rather than "no matches", which would be a
 * claim the search never made.
 */
export function PhotoMatches({
  found,
}: Readonly<{ found: Found | undefined }>): JSX.Element | undefined {
  if (found === undefined) return undefined;
  return (
    <PhotoSection
      part="photo-matches"
      title={`Matching photos · ${String(found.matches.length)}`}
    >
      <Matches found={found} />
    </PhotoSection>
  );
}

/**
The list, or the sentence that stands in for it.
*/
function Matches({ found }: Readonly<{ found: Found }>): JSX.Element {
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
      {found.matches.map((match) => (
        <li key={`${match.kind}:${match.id}`} className="flex flex-col gap-1">
          <Thumbnail match={match} />
          <span className="text-quiet">
            <Mono step="xs">{nameOf(match)}</Mono>
          </span>
        </li>
      ))}
    </ul>
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
