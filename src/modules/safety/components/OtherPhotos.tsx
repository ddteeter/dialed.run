import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode, Ref } from "react";

import { Mono } from "../../../ui";
import type { OtherPhoto, OtherPhotos as Others } from "../other-photos";
import { useKitOriginSearch } from "./kit-origin";
import { reviewPhotoSrc } from "./review-photo-src";
import { shortId } from "./short-id";

/**
 * The same runner's other photos, on a Review row about an intimate image
 * (D-117, R-145 c): the reasonable effort on copies the TAKE IT DOWN Act
 * asks for, made by a person looking. `PhotoMatches` beside it is the
 * fingerprint search across every runner (D-142).
 *
 * **Undesigned** (design deltas item 63): existing primitives and bracket
 * text only. Each photo is served from `/desk/review-photo/`, as the
 * row's own are, because a copy may be hidden too, and each carries its
 * id, which the takedown form under Review takes. A photo whose kit's page
 * an operator can open links to it; a private kit, or one hidden pending
 * review, has no page an operator can open yet (register R-154), so its
 * photo is shown without a link.
 *
 * Nothing renders for a row that lists none (`undefined`): a link that is
 * not ours names no runner. An empty list says so in words, because "this
 * runner has posted nothing else" is an answer the operator needs, and its
 * kicker has no count (round 38 #63a).
 *
 * **The kicker counts them all** (round 38 #63a), so it reads
 * `THEIR OTHER PHOTOS · 14` with 12 shown. Past the 12, the block ends in
 * "+ 2 more · Open @name in Runners", which opens the runner in D8.
 *
 * **R55·198 packs them**: fixed square tiles, 96 six across from `desk`
 * and three across the column on a phone, each id cut to its first and
 * last four characters, the whole id its tooltip and what is said.
 */
export function OtherPhotos({
  others,
}: Readonly<{
  others: Others | undefined;
}>): JSX.Element | undefined {
  if (others === undefined) return undefined;
  const { photos, total } = others;
  return (
    <PhotoSection
      part="other-photos"
      level={3}
      title={
        total === 0
          ? "Their other photos"
          : `Their other photos · ${String(total)}`
      }
    >
      {photos.length === 0 ? (
        <span className="text-micro text-quiet">
          No other photos from this runner.
        </span>
      ) : (
        <ul className="m-0 grid list-none grid-cols-3 gap-x-3 gap-y-2 p-0 desk:grid-cols-[repeat(6,--spacing(24))]">
          {photos.map((photo) => (
            <li key={photo.id} className="flex min-w-0 flex-col gap-1">
              <Thumbnail photo={photo} />
              <span title={photo.id} className="text-muted">
                <span aria-hidden="true">
                  <Mono step="xs">{shortId(photo.id)}</Mono>
                </span>
                <span className="sr-only">{photo.id}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <MorePhotos more={total - photos.length} handle={others.handle} />
    </PhotoSection>
  );
}

/**
 * The frame both photo lists on a Review row share (this and
 * `PhotoMatches`, and Review's ReleaseHolds): a mono heading carrying the
 * count, then the list or the sentence standing in for it. `titleRef`
 * makes the heading a place focus can be put by script (MATCHING PHOTOS,
 * once its last garment tile is decided — round 42 #89); it is a heading,
 * not a control, so never a tab stop.
 */
export function PhotoSection({
  part,
  title,
  level,
  titleRef,
  children,
}: Readonly<{
  part: string;
  title: string;
  /**
   * Where the section sits under Review's h1: 2 beside the page's own
   * lists (Held in the last day), 3 inside a row of one of them (a row's
   * other photos, its matches). A screen reader moves by heading, and a
   * kicker drawn as a span was not one (a11y judgment audit, 2026-11-04).
   */
  level: 2 | 3;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  children: ReactNode;
}>): JSX.Element {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div data-part={part} className="flex flex-col gap-2">
      <Heading
        ref={titleRef}
        tabIndex={titleRef === undefined ? undefined : -1}
        className="text-label uppercase"
      >
        <Mono step="xs">{title}</Mono>
      </Heading>
      {children}
    </div>
  );
}

/**
 * What the 12 leave out: a count, and D8 filtered to the runner, where
 * the rest of them can be looked at. A runner with no handle cannot be
 * searched for, so the count stands alone.
 */
function MorePhotos({
  more,
  handle,
}: Readonly<{ more: number; handle: string | undefined }>):
  JSX.Element | undefined {
  if (more <= 0) return undefined;
  const count = `+ ${String(more)} more`;
  return (
    <span data-part="more-photos" className="self-start uppercase">
      {handle === undefined ? (
        <Mono step="sm">{count}</Mono>
      ) : (
        <Link
          to="/desk/runners"
          search={{ query: handle, filter: "all" }}
          className="target text-ink"
        >
          <Mono step="sm">{`${count} · Open @${handle} in Runners`}</Mono>
        </Link>
      )}
    </span>
  );
}

/**
 * One photo, a link to the Desk's view of its kit (#388), which opens
 * whatever the kit's audience or state. The alt names the photo by its
 * id, so a list of them is not the same name read over and over.
 */
function Thumbnail({ photo }: Readonly<{ photo: OtherPhoto }>): JSX.Element {
  return (
    <Link
      to="/desk/kit/$entryId"
      params={{ entryId: photo.entryId }}
      search={useKitOriginSearch()}
      className="block"
    >
      <img
        src={reviewPhotoSrc(photo.photoKey)}
        alt={`${photo.id}: open its kit`}
        className="aspect-square w-full rounded-tight border border-hairline object-cover"
      />
    </Link>
  );
}
