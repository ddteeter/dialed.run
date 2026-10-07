import type { JSX } from "react";

import type { garmentCategories } from "../../../lib/contracts";
import type { GarmentType } from "../../../lib/contracts/garment-fields";
import { normalizeIdentity } from "../../../lib/normalize";
import { formatTempRange } from "../../../lib/contracts/thermal";
import { Mono, RailCard } from "../../../ui";
import { garmentLabel, runsLabel } from "../label";
import { photoUrlFor } from "../photo-url";
import { retiredMonthLabel } from "../retired-label";
import type { ClosetItemView } from "../service";
import { garmentTypePlurals, kindLabel } from "../type-labels";
import { useRunnerZone } from "./use-runner-zone";

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
 * worn, then its standing — retired, not judged yet, or how often it was
 * dialed and the range it works in. A retirement is dated by month and
 * year here (round 28 #13, "RETIRED MAR 2026"), not the closet's day.
 */
function recordLine(view: ClosetItemView, zone: string | undefined): string {
  const summary = view.performance?.summary;
  const worn = runsLabel(summary?.runCount ?? 0);
  if (view.item.retired) {
    return `${worn} · ${retiredMonthLabel(view.item.retiredAt, zone)}`;
  }
  // `summary === undefined` folded into this guard (rather than checked
  // via `summary?.verdictCount ?? 0 === 0` as before) narrows `summary` to
  // defined for the rest of the function, so `summary.dialedCount` below
  // needs no `?.` of its own.
  if (summary === undefined || summary.verdictCount === 0) {
    return `${worn} · No verdict yet`;
  }
  const dialed = `${String(summary.dialedCount)}/${String(summary.verdictCount)} dialed`;
  const range =
    view.tempRange === undefined ? undefined : formatTempRange(view.tempRange);
  return range === undefined
    ? `${worn} · ${dialed}`
    : `${worn} · ${dialed} ${range}`;
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
    view.item.retired ? "Retired" : undefined,
  ]
    .filter((flag) => flag !== undefined)
    .join(" · ");
}

function Row({
  view,
  typed,
  zone,
}: Readonly<{
  view: ClosetItemView;
  typed: { brand: string; name: string };
  zone: string | undefined;
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
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-body font-semibold">
          {garmentLabel({
            name: view.item.name,
            brand: view.item.brand,
            isGeneric: view.isGeneric,
          })}
        </span>
        {/* MONO.sm, the metadata row's step (round 28 #13). */}
        <Mono step="sm" className="text-label">
          {recordLine(view, zone)}
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
 * F at the desk's one rail card (round 26 #10): what is already in the
 * closet in the category being added, so a runner about to add a second
 * Rover Half-zip sees the first. Read-only, and the rows do not link: a
 * link would lead away from a half-filled form over a glance.
 *
 * **By category and type**, as the board titles and matches it (R-112):
 * "Already in your closet · Top · Half-zip" once a type is picked, and
 * the category's alone before one is.
 */
export function AlreadyInCloset({
  category,
  type,
  pieces,
  typed,
}: Readonly<{
  category: Category;
  /**
  The picked type, if one is.
  */
  type?: GarmentType | undefined;
  /**
  This category's pieces, or this type's, newest first, up to five.
  */
  pieces: readonly ClosetItemView[];
  /**
  What the form holds now, for `SAME NAME`.
  */
  typed: { brand: string; name: string };
}>): JSX.Element {
  const zone = useRunnerZone();
  return (
    <RailCard title={`Already in your closet · ${kindLabel(category, type)}`}>
      {pieces.length === 0 ? (
        <p className="m-0 text-small text-label">
          {`No ${type === undefined ? CATEGORY_PLURALS[category] : garmentTypePlurals[type]} yet.`}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {pieces.map((view) => (
            <Row key={view.item.id} view={view} typed={typed} zone={zone} />
          ))}
        </ul>
      )}
    </RailCard>
  );
}
