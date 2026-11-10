import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { audienceWord, verdictLabel } from "../../../lib/contracts";
import { formatTemp } from "../../../lib/contracts/temperature";
import { clockLabel, monthDayLabel } from "../../../lib/dates";
import { Bracketed, Icon, Mono } from "../../../ui";
import type { DeskKit as Kit, DeskKitPhoto } from "../desk-kit";
import { kitBackLink, type KitOriginSearch } from "./kit-origin";
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
 * **Round 51 · 153 (#527).** In the board's order: the back link, the
 * state band, the run line, the photos (unblurred, as Review shows them),
 * the verdict, the garments and the notes. Read-only: the actions stay on
 * the row the operator came from, which the back link names and returns
 * to. A removed kit keeps its band and run line, and says "Removed.
 * Photos deleted." where the photos were.
 *
 * **Marked guesses (Design 155):** the board draws no heading and no kit
 * id, so the h1 is for screen readers only and the id, which the takedown
 * form takes, comes last; a removed kit still shows its verdict, garments
 * and notes.
 */
export function DeskKit({
  kit,
  origin = {},
}: Readonly<{
  kit: Kit | undefined;
  origin?: KitOriginSearch | undefined;
}>): JSX.Element {
  return (
    <section data-part="desk-kit" className="flex flex-col gap-6">
      <BackLink origin={origin} />
      <h1 className="sr-only">Kit</h1>
      {kit === undefined ? (
        <p className="m-0 text-body">No kit has this id. It may be deleted.</p>
      ) : (
        <KitBody kit={kit} />
      )}
    </section>
  );
}

/**
 * The way back to the row the operator came from ("Back to the report",
 * "Back to the request"), or to Review with no origin.
 */
function BackLink({
  origin,
}: Readonly<{ origin: KitOriginSearch }>): JSX.Element {
  const { label, hash } = kitBackLink(origin);
  return (
    <Link
      to="/desk/review"
      {...(hash === undefined ? {} : { hash })}
      className="target inline-flex items-center gap-2 self-start text-ink no-underline"
    >
      <Icon name="back" size={20} />
      <span className="text-body">{label}</span>
    </Link>
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
      <RunLine kit={kit} />
      {kit.moderationStatus === "removed" ? (
        <p data-part="kit-photos" className="m-0 text-body">
          Removed. Photos deleted.
        </p>
      ) : (
        <PhotoSection part="kit-photos" level={2} title={photosTitle(kit)}>
          <KitList
            empty="No photos on this kit."
            className="m-0 flex list-none flex-wrap gap-3 p-0"
            items={kit.photos.map((photo) => (
              <KitPhoto key={photo.id} photo={photo} />
            ))}
          />
        </PhotoSection>
      )}
      <span data-part="kit-verdict" className="text-body">
        {verdictLabel(kit.verdict) ?? "No verdict"}
      </span>
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
      {kit.caption === undefined ? undefined : (
        <p data-part="kit-caption" className="m-0 text-body break-words">
          {kit.caption}
        </p>
      )}
      <span className="text-quiet select-all">
        <Mono step="sm">{kit.id}</Mono>
      </span>
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
 * The run line (Round 51 · 153): when and where, because a report is
 * often about both. The day and start time in the run's zone, the judged
 * feels-like in the operator's unit, the moisture and the city, as
 * `NOV 4 · 7:12 AM · 41° · DAMP · BOSTON`; a part the kit has no value for
 * is left out. Nothing for a run since deleted.
 */
function RunLine({ kit }: Readonly<{ kit: Kit }>): JSX.Element | undefined {
  const { run } = kit;
  if (run === undefined) return undefined;
  const parts = [
    monthDayLabel(run.startedAt, run.timeZone),
    clockLabel(run.startedAt, run.timeZone),
    run.feelsLikeC === undefined
      ? undefined
      : formatTemp(run.feelsLikeC, kit.tempUnit),
    run.moisture,
    kit.city,
  ];
  return (
    <span data-part="kit-run" className="text-ink uppercase">
      <Mono step="sm">
        {parts.filter((part) => part !== undefined).join(" · ")}
      </Mono>
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
