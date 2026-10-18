import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "../../../ui";
import type { OtherPhoto } from "../other-photos";

/**
 * The same runner's other photos, on a Review row about an intimate image
 * (D-117, R-145 c): the reasonable effort on copies the TAKE IT DOWN Act
 * asks for, made by a person looking, since nothing hashes photos.
 *
 * **Undesigned** (design deltas item 63): existing primitives and bracket
 * text only. Each photo is served from `/safety/review-photo/`, as the
 * row's own are, because a copy may be hidden too, and each carries its
 * id, which the takedown form under Review takes. A photo whose kit's page
 * an operator can open links to it; a private kit, or one hidden pending
 * review, has no page an operator can open yet (register R-154), so its
 * photo is shown without a link.
 *
 * Nothing renders for a row that lists none (`undefined`): a link that is
 * not ours names no runner. An empty list says so in words, because "this
 * runner has posted nothing else" is an answer the operator needs.
 */
export function OtherPhotos({
  photos,
}: Readonly<{
  photos: readonly OtherPhoto[] | undefined;
}>): JSX.Element | undefined {
  if (photos === undefined) return undefined;
  return (
    <div data-part="other-photos" className="flex flex-col gap-2">
      <span className="text-label uppercase">
        <Mono step="xs">Their other photos · {String(photos.length)}</Mono>
      </span>
      {photos.length === 0 ? (
        <span className="text-micro text-quiet">
          No other photos from this runner.
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
          {photos.map((photo) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <Thumbnail photo={photo} />
              <span className="text-quiet">
                <Mono step="xs">{photo.id}</Mono>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One photo: a link to its kit when the operator can open it, the image
 * alone when not. The alt names the photo by its id, so a list of them is
 * not the same name read over and over.
 */
function Thumbnail({ photo }: Readonly<{ photo: OtherPhoto }>): JSX.Element {
  const image = (
    <img
      src={`/safety/review-photo/${photo.photoKey}`}
      alt={
        photo.canOpen
          ? `Photo ${photo.id}: open its kit`
          : `Photo ${photo.id}, on a kit an operator cannot open`
      }
      className="h-32 w-auto border border-hairline"
    />
  );
  return photo.canOpen ? (
    <Link
      to="/feed/entry/$entryId"
      params={{ entryId: photo.entryId }}
      className="target self-start"
    >
      {image}
    </Link>
  ) : (
    image
  );
}
