import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import {
  uiGroupLabels,
  type garmentCategories,
  type TempUnit,
  type UiGroup,
} from "../../../lib/contracts";
import type { GarmentType } from "../../../lib/contracts/garment-fields";
import { normalizeIdentity } from "../../../lib/normalize";
import { worksAtForms } from "../../../lib/contracts/measures";
import { Mono, RailCard, Spoken } from "../../../ui";
import { garmentLabel } from "../../../lib/garment-label";
import { runsLabel } from "../../../lib/runs-label";
import { photoUrlFor } from "../photo-url";
import type { ClosetItemView } from "../service";
import { garmentTypePlurals } from "../type-labels";

type Category = (typeof garmentCategories)[number];

/**
 * Each category as the empty line names it — "No tops yet." Display copy
 * keyed by the contract's categories, which `satisfies` holds to the set.
 */
const CATEGORY_PLURALS = {
  top: "tops",
  bottom: "bottoms",
  headwear: "headwear",
  neckwear: "neckwear",
  gloves: "gloves",
  socks: "socks",
  shoes: "shoes",
  accessory: "accessories",
} as const satisfies Record<Category, string>;

/**
 * The mono line under a row's name (round 26 #10): how often it has been
 * worn, then its standing — not judged yet, or how often it was dialed and
 * the range it works in. A retired piece says so once, as the tag at the
 * right (Round 55 · 193), so its line reads like every other row's.
 *
 * The line draws "8/9 dialed 3–8°", which a screen reader would say as
 * "eight slash nine dialed". The ratio is voiced as "8 of 9 runs dialed"
 * and the range as "3 to 8 degrees"; nothing is added that the line does
 * not draw (R59·323), so the range reads whole after the ratio.
 */
function RecordLine({
  view,
  tempUnit,
}: Readonly<{
  view: ClosetItemView;
  tempUnit: TempUnit;
}>): JSX.Element {
  const summary = view.performance?.summary;
  const worn = runsLabel(summary?.runCount ?? 0);
  // `summary === undefined` folded into this guard (rather than checked
  // via `summary?.verdictCount ?? 0 === 0` as before) narrows `summary` to
  // defined for the rest of the function, so `summary.dialedCount` below
  // needs no `?.` of its own.
  if (summary === undefined || summary.verdictCount === 0) {
    return <>{`${worn} · No verdict yet`}</>;
  }
  const dialed = String(summary.dialedCount);
  const range =
    view.tempRange === undefined
      ? undefined
      : worksAtForms(view.tempRange, tempUnit);
  return (
    <>
      {`${worn} · `}
      <span aria-hidden="true">
        {`${dialed}/${String(summary.verdictCount)} dialed`}
      </span>
      <span className="sr-only">
        {`${dialed} of ${runsLabel(summary.verdictCount)} dialed`}
      </span>
      {range === undefined ? undefined : (
        <>
          {" "}
          {/* "40–58°" drawn, "40 to 58 degrees" said (round 53 · 162.3). */}
          <Spoken {...range} />
        </>
      )}
    </>
  );
}

/**
 * Whether a piece is the one being typed: brand and name the same once
 * normalised as products normalise them, so "janji  rover half-zip" is
 * the Janji Rover Half-zip already in the closet. Nothing matches until a
 * name is typed.
 */
function isSameName(
  view: ClosetItemView,
  typed: { brand: string; name: string },
): boolean {
  const name = normalizeIdentity(typed.name);
  return (
    name !== "" &&
    normalizeIdentity(view.item.name) === name &&
    normalizeIdentity(view.item.brand ?? "") === normalizeIdentity(typed.brand)
  );
}

function flagsOf(
  view: ClosetItemView,
  typed: { brand: string; name: string },
): string {
  return [
    isSameName(view, typed) ? "Same name" : undefined,
    // The word alone, as Round 56 · 248 draws the tag: round 28 #13's
    // "RETIRED MAR 2026" took more than half a 390 row (R2-CLOSET-02).
    view.item.retired ? "Retired" : undefined,
  ]
    .filter((flag) => flag !== undefined)
    .join(" · ");
}

function Row({
  view,
  typed,
  tempUnit,
}: Readonly<{
  view: ClosetItemView;
  typed: { brand: string; name: string };
  tempUnit: TempUnit;
}>): JSX.Element {
  const photo = photoUrlFor(view.item);
  const flags = flagsOf(view, typed);
  return (
    <li className="flex items-center gap-3 border-t border-hairline pt-3">
      {photo === undefined ? (
        // The hatch, which means "no photo" everywhere: `ink.css`'s
        // `.photo-hatch`, the system's one hatch on T1's photo fill.
        <span
          data-part="thumb"
          data-state="no-photo"
          aria-hidden="true"
          className="photo-hatch size-12 shrink-0 rounded-field"
        />
      ) : (
        <img
          data-part="thumb"
          src={photo}
          alt=""
          className="size-12 shrink-0 rounded-field object-cover"
        />
      )}
      {/* One line each, truncated, as 248 draws the row: the name and
          the meta never wrap beside the tag (R2-CLOSET-02). */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span data-part="name" className="truncate text-body font-semibold">
          {garmentLabel({
            name: view.item.name,
            brand: view.item.brand,
            isGeneric: view.isGeneric,
          })}
        </span>
        {/* MONO.sm, the metadata row's step (round 28 #13). */}
        <Mono step="sm" className="truncate text-label">
          <RecordLine view={view} tempUnit={tempUnit} />
        </Mono>
      </span>
      {flags === "" ? undefined : (
        // Ink, not the cold hue (round 28 #13): hue means verdict, and a
        // match is not one.
        <Mono step="xs" className="ml-auto shrink-0 text-ink">
          {flags}
        </Mono>
      )}
    </li>
  );
}

/**
The most pieces the card lists; a link counts the rest.
*/
const SHOWN = 5;

interface AlreadyInClosetProps {
  category: Category;
  /**
  The picked type, if one is.
  */
  type?: GarmentType | undefined;
  /**
  The group the form's piece would be filed in, as screen C files it.
  */
  group: UiGroup;
  /**
  That group's every piece, in Round 55 · 193's order; absent when the
  group has none.
  */
  pieces: readonly ClosetItemView[] | undefined;
  /**
  What the form holds now, for `SAME NAME`.
  */
  typed: { brand: string; name: string };
  tempUnit: TempUnit;
}

/**
 * Round 56 · 248: under the five, "See all 12 in Tops", which opens C on
 * that group, counting the whole group as C does. Under six pieces the
 * card already shows them all, and there is no link.
 */
function SeeAllLink({
  total,
  group,
}: Readonly<{ total: number; group: UiGroup }>) {
  if (total <= SHOWN) return;
  return (
    <Link
      to="/closet"
      search={{ group }}
      data-part="more"
      className="target flex w-full items-center border-t border-hairline text-body font-bold text-action"
    >
      {`See all ${String(total)} in ${uiGroupLabels[group]}`}
    </Link>
  );
}

/**
 * F at the desk's one rail card (round 26 #10): what is already in the
 * closet in the group the piece being added would be filed in, so a
 * runner about to add a second Rover Half-zip sees the first. Read-only,
 * and the rows do not link: a link would lead away from a half-filled
 * form over a glance.
 *
 * **By group** (Round 56 · 248): the card draws from C's group, filed
 * the same way, so a top worn as an outer layer is in Outer for both. A
 * picked type only sorts its pieces first; it never filters. Round 40 C4
 * draws the title as a heading, in sentence case, not the rail's mono.
 */
export function AlreadyInCloset({
  category,
  type,
  group,
  pieces,
  typed,
  tempUnit,
}: Readonly<AlreadyInClosetProps>): JSX.Element {
  const plural =
    type === undefined ? CATEGORY_PLURALS[category] : garmentTypePlurals[type];
  return (
    <RailCard
      title={`Already in your closet · ${uiGroupLabels[group]}`}
      isHeading
    >
      {/* A group is absent rather than empty: closetNearby lists only a
          group that has pieces. */}
      {pieces === undefined ? (
        // Round 40 C4: the heading stays; this line replaces the rows.
        <p className="m-0 text-body text-quiet">{`No ${plural} yet.`}</p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {typeFirst(pieces, type)
              .slice(0, SHOWN)
              .map((view) => (
                <Row
                  key={view.item.id}
                  view={view}
                  typed={typed}
                  tempUnit={tempUnit}
                />
              ))}
          </ul>
          <SeeAllLink total={pieces.length} group={group} />
        </>
      )}
    </RailCard>
  );
}

/**
 * A picked type's pieces first, the rest after, each in the order given:
 * a stable sort, so the type sorts and never filters (Round 56 · 248).
 */
function typeFirst(
  pieces: readonly ClosetItemView[],
  type: GarmentType | undefined,
): ClosetItemView[] {
  // A stored type is a string or null and no pick is undefined, so with
  // nothing picked no piece matches and the order stands.
  const ofType = (view: ClosetItemView): number =>
    Number(Object.is(view.item.type, type));
  return pieces.toSorted((a, b) => ofType(b) - ofType(a));
}
