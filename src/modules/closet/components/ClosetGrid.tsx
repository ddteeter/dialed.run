import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import { uiGroups } from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/thermal";
import { Bracketed, Icon, Mono, useListMotion } from "../../../ui";
import { garmentLabel } from "../label";
import type { ClosetItemView, ClosetListing } from "../service";

function itemLabel(view: ClosetItemView): string {
  return garmentLabel({
    name: view.item.name,
    brand: view.item.brand,
    isGeneric: view.isGeneric,
  });
}

function tempLabel(view: ClosetItemView): string {
  if (!view.tempRange) return "Untested"; // uppercased by <Bracketed> in CSS
  return formatTempRange(view.tempRange) ?? "Untested";
}

const itemKey = (view: ClosetItemView): string => view.item.id;

/**
 * The flat grid's order: every active piece, then every retired one —
 * round 22, item 16: retired tiles are *"sorted last"*. Within each, the
 * derived UI groups in screen C's order, so like still sits by like
 * without a heading over each; within a group, the order the rows came.
 */
function gridOrder(items: readonly ClosetItemView[]): ClosetItemView[] {
  return items.toSorted(
    (a, b) =>
      Number(a.item.retired) - Number(b.item.retired) ||
      uiGroups.indexOf(a.uiGroup) - uiGroups.indexOf(b.uiGroup),
  );
}

/**
`47 pieces` — the heading follows what the grid is showing.
*/
function piecesHeading(count: number): string {
  return count === 1 ? "1 piece" : `${String(count)} pieces`;
}

/**
 * Adding a garment is the grid's dashed tile (§6c.10: *"never a bar
 * action"*), and it is the last cell of the grid whatever the grid holds —
 * the only cell, on an empty closet.
 */
function AddTile(): JSX.Element {
  return (
    <li>
      <Link
        to="/closet/new"
        className="target flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-field border border-dashed border-hairline-2 p-3 text-muted no-underline"
      >
        <Icon name="add" />
        <Mono step="xs">Add garment</Mono>
      </Link>
    </li>
  );
}

/**
 * One garment's tile.
 *
 * The tags ride the kicker — `[GENERIC]`, `[RETIRED]` — and a retired tile
 * is otherwise **the same tile, no dimming**: *"retired is a fact, not a
 * disabled state."* The kicker sits above the name on screen but after it
 * in the markup (`order-first`), so the link's accessible name still
 * starts with what the piece is called.
 */
function Tile({ view }: Readonly<{ view: ClosetItemView }>): JSX.Element {
  return (
    <Link
      to="/closet/$itemId"
      params={{ itemId: view.item.id }}
      className="target row-press flex h-full flex-col gap-1 rounded-field border border-hairline bg-panel p-3 no-underline"
    >
      <span className="text-body font-semibold">{itemLabel(view)}</span>
      {view.isGeneric || view.item.retired ? (
        <span className="order-first flex gap-2">
          {view.isGeneric ? (
            <Bracketed step="xs" className="text-muted">
              Generic
            </Bracketed>
          ) : undefined}
          {view.item.retired ? (
            <Bracketed step="xs" className="font-semibold text-ink">
              Retired
            </Bracketed>
          ) : undefined}
        </span>
      ) : undefined}
      {/* **Muted, never teal.** T2: teal means *dialed* — a verdict — and
          a garment's working range is not one. Board C draws the band line
          in `--muted`, and round 16 says coverage is monochrome. */}
      <Bracketed className="text-muted">{tempLabel(view)}</Bracketed>
    </Link>
  );
}

/**
 * The grid itself, and the two moves the doctrine gives it.
 *
 * It renders `shown` rather than `items` so a tile that has stopped
 * matching — a retired piece when the switch goes off — is still on
 * screen while it collapses. That is the whole of "retire, don't delete"
 * expressed as a move: the tile folds shut where it stood instead of
 * blinking out, and the rest reflow into the space.
 */
function Tiles({
  items,
}: Readonly<{ items: readonly ClosetItemView[] }>): JSX.Element {
  const { shown, leaving, listRef } = useListMotion(items, itemKey);
  return (
    <ul
      ref={listRef}
      data-part="grid"
      // DS3's reflow rule for a grid of garments, verbatim: "grids of runs
      // or garments go from 2 tracks to `auto-fill, minmax(180px, 1fr)`".
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-0"
    >
      {shown.map((view) => (
        <li
          key={view.item.id}
          className="collapsing-row"
          data-leaving={leaving.has(view.item.id) ? "true" : undefined}
        >
          <Tile view={view} />
        </li>
      ))}
      <AddTile />
    </ul>
  );
}

export interface ClosetGridProps {
  listing: ClosetListing;
  /**
  Open with retired pieces shown. Set after retiring one, so the runner
  lands on the piece still present and marked, rather than on a grid it
  has just vanished from.
  */
  initialShowRetired?: boolean;
}

/**
 * Screen C without its rail — round 22, item 16, which is §6c.10's
 * one-column fallback: **one flat grid**, a heading row of `47 pieces` on
 * the left and a `Show retired` switch on the right, retired tiles last.
 *
 * The rail itself is D-94: round 16 made it three real filter groups and
 * all-or-nothing, and this closet has no filters yet. Until it does, the
 * grid is the page at every width.
 *
 * **The empty closet is the statement, one line and the Add tile**
 * (ruling 16), in the same places: the heading says `[ NOTHING IN HERE YET
 * ]` where the count would be, and the grid holds only the tile. One
 * heading either way, because a screen has one (Accessibility Contract
 * rule 04). There is no switch on an empty closet because there is
 * nothing retired to show — the switch's own condition says so.
 */
export function ClosetGrid({
  listing,
  initialShowRetired = false,
}: Readonly<ClosetGridProps>) {
  const [showRetired, setShowRetired] = useState(initialShowRetired);

  const visible = gridOrder(
    listing.items.filter((view) => showRetired || !view.item.retired),
  );
  const retiredCount = listing.items.filter((view) => view.item.retired).length;
  // `totalCount`, not the visible rows: a closet holding only retired
  // pieces is not empty, and "add what you run in most" to someone with a
  // full closet reads as data loss.
  const isEmpty = listing.totalCount === 0;

  return (
    <div className="flex flex-col gap-6 px-4 py-6 wide:px-6">
      <div className="flex flex-col gap-2">
        <div
          data-part="grid-header"
          className="flex items-center justify-between gap-3"
        >
          <h1 className="m-0 font-display text-title">
            {isEmpty ? (
              <Bracketed>Nothing in here yet</Bracketed>
            ) : (
              piecesHeading(visible.length)
            )}
          </h1>
          {/* Only when there is something to show: a switch that changes
              nothing is a dead control. */}
          {retiredCount > 0 ? (
            <label className="target flex cursor-pointer items-center gap-2 text-body font-semibold">
              Show retired
              <input
                type="checkbox"
                role="switch"
                checked={showRetired}
                onChange={(event) => {
                  setShowRetired(event.target.checked);
                }}
              />
            </label>
          ) : undefined}
        </div>
        {isEmpty ? (
          <p className="m-0 text-body text-quiet">
            Add what you run in most. Three pieces is enough to start.
          </p>
        ) : undefined}
        {listing.genericCount > 0 ? (
          <p className="m-0 text-small text-quiet">
            <Mono>
              {listing.genericCount} of {listing.totalCount}
            </Mono>{" "}
            pieces are still generic — name the ones you reach for.
          </p>
        ) : undefined}
      </div>
      <Tiles items={visible} />
    </div>
  );
}

