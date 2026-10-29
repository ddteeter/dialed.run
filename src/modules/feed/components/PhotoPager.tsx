import { Mono } from "../../../ui";

import { DeletePhoto } from "./RetractEntry";
import type { DeletePhotoProps } from "./RetractEntry";

/**
 * The photos, one at a time: a scroll-snapping row a thumb swipes, each
 * photo carrying its own `1 / 2` from two photos, and its delete top right
 * when the viewer owns it. Absent with no photos.
 *
 * D's, and `/k`'s since design 161 step 8, so its own file: `/k` must not
 * reach D's screen to draw it. `srcOf` is where a key is served: the
 * app's own photo route on D, and the public bucket's URL as it stands on
 * `/k`.
 */
export function PhotoPager({
  photoKeys,
  deletePhoto,
  srcOf = (key) => `/feed/photo/${key}`,
}: Readonly<{
  photoKeys: readonly string[];
  deletePhoto: DeletePhotoProps["deletePhoto"] | undefined;
  srcOf?: (key: string) => string;
}>) {
  if (photoKeys.length === 0) return;
  // The counter shows from two photos; a lone one has none (round 35 #53c).
  const isPaged = photoKeys.length > 1;
  return (
    <ul
      data-part="photo"
      className="m-0 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto p-0"
    >
      {photoKeys.map((key, index) => (
        <li key={key} className="relative w-full shrink-0 snap-start">
          <img
            src={srcOf(key)}
            alt=""
            className="aspect-4/3 w-full rounded-card object-cover"
          />
          {isPaged ? (
            <span className="absolute bottom-3 left-3 rounded-tight bg-ground px-2 py-1 text-label">
              <Mono step="xs">
                {String(index + 1)} / {String(photoKeys.length)}
              </Mono>
            </span>
          ) : undefined}
          {deletePhoto === undefined ? undefined : (
            <DeletePhoto
              photoKey={key}
              index={index}
              deletePhoto={deletePhoto}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
