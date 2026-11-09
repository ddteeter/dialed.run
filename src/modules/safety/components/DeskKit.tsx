import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { audienceWord, verdictLabel } from "../../../lib/contracts";
import { monthDayLabel } from "../../../lib/dates";
import { Bracketed, Mono } from "../../../ui";
import type { DeskKit as Kit, DeskKitPhoto } from "../desk-kit";
import { PhotoSection } from "./OtherPhotos";
import { reviewPhotoSrc } from "./review-photo-src";

/**
 * Where review left a kit, in the band's words.
 */
const STATE_WORD = {
  ok: "live",
  hidden_pending_review: "hidden pending review",
  removed: "removed",
} as const satisfies Record<Kit["moderationStatus"], string>;

/**
 * A kit as an operator opens it from Review or a removal request (R-154,
 * #388), whatever its audience or state: `/feed/entry/$entryId` sends an
 * operator away from a private or hidden kit, as it does any runner.
 *
 * **Design 153 (#527): no board yet, built on a marked guess.** The band
 * first (whose, who may see it, where review left it), then the run, the
 * verdict and caption, the photos and the garments, in the Desk's own
 * primitives. Each photo is served from `/desk/review-photo/` and carries
 * its id, which the takedown form takes; one screening has not passed
 * says how it stands. No kit with the id says so in words.
 */
export function DeskKit({
  kit,
}: Readonly<{ kit: Kit | undefined }>): JSX.Element {
  return (
    <section data-part="desk-kit" className="flex flex-col gap-6">
      <h1 className="m-0 font-display text-title uppercase">Kit</h1>
      {kit === undefined ? (
        <p className="m-0 text-body">No kit has this id. It may be deleted.</p>
      ) : (
        <KitBody kit={kit} />
      )}
      <Link to="/desk/review" className="target self-start text-ink">
        <Mono step="sm">Back to Review</Mono>
      </Link>
    </section>
  );
}

function KitBody({ kit }: Readonly<{ kit: Kit }>): JSX.Element {
  return (
    <>
      <span data-part="kit-band" className="flex flex-wrap gap-2 uppercase">
        <Runner handle={kit.handle} runnerId={kit.runnerId} />
        <Bracketed>{audienceWord[kit.audience]}</Bracketed>
        <Bracketed>{STATE_WORD[kit.moderationStatus]}</Bracketed>
      </span>
      <span className="text-quiet select-all">
        <Mono step="sm">{kit.id}</Mono>
      </span>
      <RunLine kit={kit} />
      <span data-part="kit-verdict" className="text-body">
        {verdictLabel(kit.verdict) ?? "No verdict"}
      </span>
      {kit.caption === undefined ? undefined : (
        <p data-part="kit-caption" className="m-0 text-body break-words">
          {kit.caption}
        </p>
      )}
      <PhotoSection part="kit-photos" level={2} title={photosTitle(kit)}>
        <KitList
          empty="No photos on this kit."
          className="m-0 flex list-none flex-wrap gap-3 p-0"
          items={kit.photos.map((photo) => (
            <KitPhoto key={photo.id} photo={photo} />
          ))}
        />
      </PhotoSection>
      <PhotoSection part="kit-garments" level={2} title="Garments">
        <KitList
          empty="No garments on this kit."
          className="m-0 flex list-none flex-col gap-1 p-0"
          items={kit.garments.map((garment) => (
            <li key={garment.id} className="text-body">
              {[garment.name, garment.brand, garment.category]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </li>
          ))}
        />
      </PhotoSection>
    </>
  );
}

/**
 * A section's rows, or the words saying there are none.
 */
function KitList({
  empty,
  className,
  items,
}: Readonly<{
  empty: string;
  className: string;
  items: readonly JSX.Element[];
}>): JSX.Element {
  return items.length === 0 ? (
    <span className="text-micro text-quiet">{empty}</span>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

function photosTitle(kit: Kit): string {
  return `Photos · ${String(kit.photos.length)}`;
}

/**
 * Whose kit, by @handle and a link to them in Runners (D8); by account id
 * when they have no handle.
 */
function Runner({
  handle,
  runnerId,
}: Readonly<{ handle: string | undefined; runnerId: string }>): JSX.Element {
  if (handle === undefined) return <Mono step="sm">{runnerId}</Mono>;
  return (
    <Link
      to="/desk/runners"
      search={{ query: handle, filter: "all" }}
      className="target text-ink"
    >
      <Mono step="sm">{`@${handle}`}</Mono>
    </Link>
  );
}

/**
The run the kit was worn on, and when; nothing for a run since deleted.
*/
function RunLine({ kit }: Readonly<{ kit: Kit }>): JSX.Element | undefined {
  if (kit.runTitle === undefined || kit.runStartedAt === undefined)
    return undefined;
  return (
    <span data-part="kit-run" className="text-body">
      {kit.runTitle} · <Mono step="sm">{monthDayLabel(kit.runStartedAt)}</Mono>
    </span>
  );
}

/**
 * One photo, its id beneath it. The alt is the id, so a list of
 * them is not one name read over and over.
 */
function KitPhoto({ photo }: Readonly<{ photo: DeskKitPhoto }>): JSX.Element {
  return (
    <li className="flex flex-col gap-1">
      <img
        src={reviewPhotoSrc(photo.photoKey)}
        alt={photo.id}
        className="h-32 w-auto border border-hairline"
      />
      <span className="text-quiet select-all">
        <Mono step="sm">{photo.id}</Mono>
      </span>
      {photo.screenStatus === "pass" ? undefined : (
        <span className="text-micro uppercase">
          <Bracketed>{`screening: ${photo.screenStatus}`}</Bracketed>
        </span>
      )}
    </li>
  );
}
