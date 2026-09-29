import type { JSX } from "react";

import { garmentCategoryLabels } from "../../../lib/contracts";
import type { garmentCategories } from "../../../lib/contracts";
import { normalizeIdentity } from "../../../lib/normalize";
import { formatTempRange } from "../../../lib/thermal";
import { Mono, RailCard } from "../../../ui";
import { garmentLabel } from "../label";
import { photoUrlFor } from "../photo-url";
import { retiredLabel } from "../retired-label";
import type { ClosetItemView } from "../service";
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

function runs(count: number): string {
  return count === 1 ? "1 run" : `${String(count)} runs`;
}

/**
 * The mono line under a row's name (round 26 #10): how often it has been
 * worn, then its standing — retired, not judged yet, or how often it was
 * dialed and the range it works in.
 */
function recordLine(view: ClosetItemView, zone: string | undefined): string {
  const summary = view.performance?.summary;
  const worn = runs(summary?.runCount ?? 0);
  if (view.item.retired) {
    return `${worn} · ${retiredLabel(view.item.retiredAt, zone)}`;
  }
  const verdicts = summary?.verdictCount ?? 0;
  if (verdicts === 0) return `${worn} · No verdict yet`;
  const dialed = `${String(summary?.dialedCount ?? 0)}/${String(verdicts)} dialed`;
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
        <span
          data-part="thumb"
          aria-hidden="true"
          className="size-12 shrink-0 rounded-field bg-photo"
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
        <Mono step="xs" className="text-label">
          {recordLine(view, zone)}
        </Mono>
      </span>
      {flags === "" ? undefined : (
        <Mono step="xs" className="ml-auto shrink-0 text-cold-text">
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
 * **By category alone.** The board titles and matches the card by
 * category and type, and F asks no type (a garment's type comes from its
 * product), so the card is the category's — a design delta.
 */
export function AlreadyInCloset({
  category,
  pieces,
  typed,
}: Readonly<{
  category: Category;
  /**
  This category's pieces, newest first, up to five.
  */
  pieces: readonly ClosetItemView[];
  /**
  What the form holds now, for `SAME NAME`.
  */
  typed: { brand: string; name: string };
}>): JSX.Element {
  const zone = useRunnerZone();
  return (
    <RailCard
      title={`Already in your closet · ${garmentCategoryLabels[category]}`}
    >
      {pieces.length === 0 ? (
        <p className="m-0 text-small text-label">
          {`No ${CATEGORY_PLURALS[category]} yet.`}
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
