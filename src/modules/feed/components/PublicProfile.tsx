import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono, WeatherAttribution } from "../../../ui";
import type { RotationPiece } from "../../closet";
import {
  moreKits,
  type PublicKitRow,
  type PublicProfile,
} from "../public-profile-shape";

import {
  Invite,
  PieceSection,
  RunnerFrame,
  type OpenWebPageProps,
  VerdictChip,
} from "./PublicFrame";

/**
 * The open web's profile (round 41 #86d) and its not-public twin (#86f):
 * `/@handle`, for anyone, signed in or not, in the frame every public page
 * wears (`PublicFrame`).
 *
 * Kits first, then the rotation — beside them at the desk (DS1's rail),
 * after them on the phone — and the invite closing the page for the
 * signed out. No follow, no counts but the kits', and a piece never links
 * to its runs.
 */

/**
 * `/@handle` for a public profile. `origin` is where the page lives, for
 * the link Report this profile hands `/takedown`.
 */
export function PublicProfilePage({
  profile,
  ...frame
}: OpenWebPageProps<{ profile: PublicProfile }>): JSX.Element {
  return (
    <RunnerFrame
      {...frame}
      page={{ handle: profile.handle }}
      handle={profile.handle}
      headingClassName="m-0 font-display text-display"
      rail={
        isRotationShown(profile.rotation) ? (
          <Rotation rotation={profile.rotation} />
        ) : undefined
      }
      closing={(isSignedIn) => (isSignedIn ? undefined : <Invite />)}
    >
      {() => <Kits profile={profile} />}
    </RunnerFrame>
  );
}

/**
 * Whether the page has a Rotation: the closet is shown and at least one
 * group has something in it. All empty is no Rotation, as the closet off
 * is (round 42 #91), with no gap where it would be.
 */
function isRotationShown(
  rotation: PublicProfile["rotation"],
): rotation is NonNullable<PublicProfile["rotation"]> {
  return (
    rotation !== undefined &&
    [rotation.inUse, rotation.shoes, rotation.retired].some(
      (group) => group.length > 0,
    )
  );
}

// Written out whole, so each can be read as one class list.
const KIT_LIST_CLASS =
  "m-0 flex list-none flex-col p-0 desk:grid desk:grid-cols-3 desk:gap-3";
const KIT_ROW_CLASS =
  "target flex items-center gap-3 border-b border-hairline py-2 text-ink no-underline desk:flex-col desk:items-start desk:border-b-0";
const MORE_CLASS =
  "target inline-flex items-center self-start text-small text-ink underline underline-offset-4";
const KIT_TILE_CLASS =
  "size-16 shrink-0 rounded-tile bg-tint desk:aspect-square desk:size-auto desk:w-full";
// The tile's box and corner, the photo cropped to it as D's pager crops.
const KIT_PHOTO_CLASS =
  "size-16 shrink-0 rounded-tile bg-tint object-cover desk:aspect-square desk:size-auto desk:w-full";

/**
 * Kits {N}: the first three (or all of them, under "Show {N} more"), a
 * link and no script, so each list is its own cached URL. The credit
 * follows when any row shows Visual Crossing's reading (D-144).
 */
function Kits({ profile }: Readonly<{ profile: PublicProfile }>) {
  const more = moreKits(profile);
  const isCredited = profile.kits.some(
    (row) => row.conditions?.isProviders === true,
  );
  return (
    <section data-part="kits" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-baseline gap-2 font-display text-heading">
        Kits
        <Mono step="md" className="text-muted">
          {String(profile.kitCount)}
        </Mono>
      </h2>
      {profile.kits.length === 0 ? (
        <p className="m-0 text-body text-quiet">No public kits yet.</p>
      ) : (
        <ul className={KIT_LIST_CLASS}>
          {profile.kits.map((row) => (
            <KitRow key={row.entryId} row={row} />
          ))}
        </ul>
      )}
      {more > 0 ? (
        <Link
          to="/@{$handle}"
          params={{ handle: profile.handle }}
          search={{ all: true }}
          reloadDocument
          className={MORE_CLASS}
        >
          {`Show ${String(more)} more`}
        </Link>
      ) : undefined}
      {isCredited ? <WeatherAttribution /> : undefined}
    </section>
  );
}

/**
 * One kit, opening its own `/k` page: the tile, the conditions with
 * the measured word teal, the day and distance in mono, the verdict's
 * chip in its hue.
 */
function KitRow({ row }: Readonly<{ row: PublicKitRow }>) {
  return (
    <li>
      <Link
        to="/k/$entryId"
        params={{ entryId: row.entryId }}
        reloadDocument
        className={KIT_ROW_CLASS}
      >
        <KitTile photo={row.photo} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {row.conditions === undefined ? undefined : (
            <span className="text-body font-semibold">
              {row.conditions.feelsLike}{" "}
              <span className="text-dialed-text">{row.conditions.sky}</span>
            </span>
          )}
          <Mono step="xs" className="text-muted">
            {`${row.day} · ${row.distance.value} ${row.distance.unit}`}
          </Mono>
        </span>
        <VerdictChip verdict={row.verdict} />
      </Link>
    </li>
  );
}

/**
 * The kit's tile: its first photo as the public bucket serves it (D-151,
 * the one `/k` shows first), cropped to the tile, or the --tint tile when
 * it has none. Decorative either way: the row's own words name the kit.
 */
function KitTile({ photo }: Readonly<{ photo: string | undefined }>) {
  return photo === undefined ? (
    <span aria-hidden="true" data-part="kit-tile" className={KIT_TILE_CLASS} />
  ) : (
    <img src={photo} alt="" data-part="kit-tile" className={KIT_PHOTO_CLASS} />
  );
}

/**
 * The rotation, read-only: IN USE, SHOES and RETIRED, each with its count,
 * a group with nothing in it left out. Only what the closet says about a
 * piece — name and type, or mileage for shoes, in MONO caps ("412 MI",
 * round 42 #91) like every mono value on the page.
 */
function Rotation({
  rotation,
}: Readonly<{ rotation: NonNullable<PublicProfile["rotation"]> }>) {
  return (
    <section data-part="rotation" className="flex flex-col gap-4">
      <h2 className="m-0 font-display text-heading">Rotation</h2>
      <RotationGroup title="In use" pieces={rotation.inUse} />
      <RotationGroup title="Shoes" pieces={rotation.shoes} />
      <RotationGroup title="Retired" pieces={rotation.retired} isRetired />
    </section>
  );
}

const PIECE_CLASS =
  "flex items-baseline justify-between gap-3 border-b border-hairline pb-2 text-body text-ink";
// Retired: --quiet and struck through, as D7 marks a revoked code.
const RETIRED_PIECE_CLASS =
  "flex items-baseline justify-between gap-3 border-b border-hairline pb-2 text-body text-quiet line-through";

function RotationGroup({
  title,
  pieces,
  isRetired = false,
}: Readonly<{
  title: string;
  pieces: readonly RotationPiece[];
  isRetired?: boolean;
}>) {
  return (
    <PieceSection
      title={title}
      level={3}
      pieces={pieces}
      itemClassName={isRetired ? RETIRED_PIECE_CLASS : PIECE_CLASS}
      row={(piece) => (
        <>
          <span>{piece.name}</span>
          <Mono step="xs" className="shrink-0">
            {piece.detail}
          </Mono>
        </>
      )}
    />
  );
}
