import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import {
  uiGroupLabels,
  uiGroups,
  type TempUnit,
  type UiGroup,
} from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/contracts/thermal";
import { Bracketed, Icon, Mono, useListMotion } from "../../../ui";
import { garmentLabel } from "../../../lib/garment-label";
import { isPhotoBeingChecked } from "../photo-url";
import { filterViews, railCounts, worksAtSpan } from "../filters";
import type { ClosetSearch } from "../inputs";
import type { ClosetItemView, ClosetListing } from "../service";
import { ClosetFilters, coverageWords } from "./ClosetFilters";
import { worksAtLabel } from "./WorksAt";

function itemLabel(view: ClosetItemView): string {
  return garmentLabel({
    name: view.item.name,
    brand: view.item.brand,
    isGeneric: view.isGeneric,
  });
}

function tempLabel(view: ClosetItemView, tempUnit: TempUnit): string {
  // "Untested" is uppercased by <Bracketed> in CSS.
  return view.tempRange
    ? (formatTempRange(view.tempRange, tempUnit) ?? "Untested")
    : "Untested";
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
 *
 * **Its height is the row's, unless it is the row.** A grid row is as tall
 * as its tallest cell, so a minimum on this tile was a minimum on whichever
 * row it landed in: a closet whose last row held the tile ran that row to
 * nearly twice the height of every row above it. The grid's equal rows
 * (`auto-rows-fr`) size it to a garment tile wherever it lands; it keeps
 * the minimum only as the only cell (`only:`), where there is no garment
 * tile to match.
 */
function AddTile(): JSX.Element {
  return (
    <li className="only:min-h-40">
      <Link
        to="/closet/new"
        className="target flex h-full flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-hairline-2 p-3 text-muted no-underline"
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
/**
 * A tile whose photo is being checked (R-69, round 27 #21) is tagged
 * `[CHECKING]`, as round 38 #64 amends `[ONLY YOU]`: it names a state, not
 * an audience, now that private means other runners (D-121). The brackets
 * are hidden from assistive tech and this sentence is said instead, as
 * `[UNDER REVIEW]` does. The garment's own page says who can't see it.
 */
export const CHECKING_NAME =
  "Being checked, other runners can't see this photo";

function Tile({
  view,
  tempUnit,
}: Readonly<{ view: ClosetItemView; tempUnit: TempUnit }>): JSX.Element {
  return (
    <Link
      to="/closet/$itemId"
      params={{ itemId: view.item.id }}
      className="target row-press flex h-full flex-col gap-1 rounded-tile border border-hairline bg-panel p-3 no-underline"
    >
      <span className="text-body font-semibold">{itemLabel(view)}</span>
      {view.isGeneric || view.item.retired || isPhotoBeingChecked(view.item) ? (
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
          {isPhotoBeingChecked(view.item) ? (
            <span data-part="checking-tag" className="text-muted">
              <span aria-hidden="true">
                <Bracketed step="xs">Checking</Bracketed>
              </span>
              <span className="sr-only">{CHECKING_NAME}</span>
            </span>
          ) : undefined}
        </span>
      ) : undefined}
      {/* **Muted, never teal.** T2: teal means *dialed* — a verdict — and
          a garment's working range is not one. Board C draws the band line
          in `--muted`, and round 16 says coverage is monochrome. */}
      <Bracketed className="text-muted">{tempLabel(view, tempUnit)}</Bracketed>
    </Link>
  );
}

interface TilesProps {
  items: readonly ClosetItemView[];
  tempUnit: TempUnit;
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
function Tiles({ items, tempUnit }: Readonly<TilesProps>): JSX.Element {
  const { shown, leaving, listRef } = useListMotion(items, itemKey);
  return (
    <ul
      ref={listRef}
      data-part="grid"
      // DS3's reflow rule for a grid of garments, verbatim: "grids of runs
      // or garments go from 2 tracks to `auto-fill, minmax(180px, 1fr)`".
      // `auto-rows-fr` makes every row the tallest row's height, so the
      // Add tile matches a garment tile even on a row of its own — one
      // column on a phone, or a count the columns divide evenly.
      className="m-0 grid list-none auto-rows-fr grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-0"
    >
      {shown.map((view) => (
        <li
          key={view.item.id}
          className="collapsing-row"
          data-leaving={leaving.has(view.item.id) ? "true" : undefined}
        >
          <Tile view={view} tempUnit={tempUnit} />
        </li>
      ))}
      <AddTile />
    </ul>
  );
}

export interface ClosetGridProps {
  listing: ClosetListing;
  /**
  The runner's unit: every range on the screen is in it.
  */
  tempUnit: TempUnit;
  /**
  The rail's filters, as the route's search holds them.
  */
  search?: ClosetSearch | undefined;
  /**
  The rail's hydrated navigation, to the whole next search; the route's
  to wire. Without it every filter works as it does before hydration.
  */
  onSearch?: ((next: ClosetSearch) => void) | undefined;
  /**
  Open with retired pieces shown. Set after retiring one, so the runner
  lands on the piece still present and marked, rather than on a grid it
  has just vanished from.
  */
  initialShowRetired?: boolean | undefined;
  /**
   * The piece a delete just took away, for round 26 #3's landing:
   * "{name} deleted." in the screen's status line.
   */
  deleted?: string | undefined;
}

const NO_SEARCH: ClosetSearch = {};

/**
 * Everything the screen shows, from the rows, the retired switch and the
 * search: the rail counts what the switch admits (not narrowed by the
 * other filters), and the grid shows what every filter leaves.
 */
export function closetScreen(
  listing: ClosetListing,
  isRetiredShown: boolean,
  search: ClosetSearch,
) {
  const admitted = listing.items.filter(
    (view) => isRetiredShown || !view.item.retired,
  );
  const visible = gridOrder(
    filterViews(admitted, {
      group: search.group,
      fromC: search.from,
      toC: search.to,
      coverage: search.coverage,
    }),
  );
  return {
    visible,
    counts: railCounts(admitted),
    span: worksAtSpan(admitted),
    retiredCount: listing.items.filter((view) => view.item.retired).length,
    isFiltered:
      search.group !== undefined ||
      search.coverage !== undefined ||
      search.from !== undefined ||
      search.to !== undefined,
  };
}

/**
 * The heading: `47 pieces`, or once a group is set `14 · Tops` — one rule
 * for all six, since "Hands / head" has no plural (owner, 2026-11-05).
 */
export function closetHeading(count: number, group: UiGroup | undefined) {
  return group === undefined
    ? piecesHeading(count)
    : `${String(count)} · ${uiGroupLabels[group]}`;
}

/**
 * Board C's `FILTERED: [34–58°] · COVERED`, while WORKS AT or COVERAGE
 * is set. GROUP is not in it: the heading already says that one.
 */
function FilteredLine({
  search,
  tempUnit,
}: Readonly<{ search: ClosetSearch; tempUnit: TempUnit }>) {
  const range = worksAtLabel(search, tempUnit);
  const parts = [
    ...(range === undefined
      ? []
      : [
          <Bracketed key="range" step="xs">
            {range}
          </Bracketed>,
        ]),
    ...(search.coverage === undefined
      ? []
      : [
          <Mono key="coverage" step="xs">
            {coverageWords[search.coverage]}
          </Mono>,
        ]),
  ];
  if (parts.length === 0) return;
  return (
    <p data-part="filtered" className="m-0 text-label">
      <Mono step="xs">Filtered: </Mono>
      {parts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <Mono key={`between-${String(index)}`} step="xs">
                {" · "}
              </Mono>,
              part,
            ],
      )}
    </p>
  );
}

/**
 * The filters matched nothing (owner, 2026-11-05; round 46 #109d): the
 * line above the grid in body text, and the way back is one link that
 * resets all three groups. The Add tile keeps its cell.
 */
function NoMatches({ onClear }: Readonly<{ onClear: () => void }>) {
  return (
    <p data-part="no-matches" className="m-0 text-body text-quiet">
      Nothing in your closet matches these filters.{" "}
      <Link to="/closet" onClick={onClear} className="target text-ink">
        Clear filters
      </Link>
    </p>
  );
}

/**
 * #109d: after Clear filters, focus goes to the header count — `0 pieces`
 * no longer, but whatever it now says — so a screen reader hears what the
 * clear did. Armed by the click and spent when the search it changed
 * arrives, because the heading is not worth moving to until it is true.
 */
function useFocusAfterClear(search: ClosetSearch) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const armedRef = useRef(false);
  useEffect(() => {
    if (!armedRef.current) return;
    armedRef.current = false;
    headingRef.current?.focus();
  }, [search]);
  return {
    headingRef,
    arm: () => {
      armedRef.current = true;
    },
  };
}

function RetiredSwitch({
  count,
  isOn,
  onToggle,
}: Readonly<{
  count: number;
  isOn: boolean;
  onToggle: (isOn: boolean) => void;
}>) {
  return (
    <label className="target flex cursor-pointer items-center gap-2 text-body font-semibold">
      {`Show retired (${String(count)})`}
      <input
        type="checkbox"
        role="switch"
        checked={isOn}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
    </label>
  );
}

/**
 * The sentence a delete leaves, written after mount rather than rendered
 * with the page: a status region announces what changes in it, and a
 * sentence that arrives with the region itself is never read out.
 */
function useDeletedStatus(deleted: string | undefined): string {
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (deleted !== undefined) setSaid(`${deleted} deleted.`);
  }, [deleted]);
  return said;
}

/**
 * Screen C — round 22, item 16's flat grid (a heading row of `47 pieces`
 * and a `Show retired` switch, retired tiles last), and round 16's rail of
 * three filter groups beside it at desk, which R-94 made all-or-nothing:
 * it is here whole. Below desk the same groups are chips above the grid.
 *
 * **The empty closet is the statement, one line and the Add tile**
 * (ruling 16), in the same places: the heading says `[ NOTHING IN HERE YET
 * ]` where the count would be, and the grid holds only the tile. One
 * heading either way, because a screen has one (Accessibility Contract
 * rule 04). An empty closet has no switch and no filters: there is
 * nothing retired to show and nothing to narrow, and a rail of zeros is
 * the rail-of-air DS5 forbids.
 */
export function ClosetGrid({
  listing,
  initialShowRetired = false,
  deleted,
  tempUnit,
  search = NO_SEARCH,
  onSearch,
}: Readonly<ClosetGridProps>) {
  const [isRetiredShown, setRetiredShown] = useState(initialShowRetired);
  const said = useDeletedStatus(deleted);
  const screen = closetScreen(listing, isRetiredShown, search);
  const focus = useFocusAfterClear(search);
  // `totalCount`, not the visible rows: a closet holding only retired
  // pieces is not empty, and "add what you run in most" to someone with a
  // full closet reads as data loss.
  const isEmpty = listing.totalCount === 0;
  const filters = {
    search,
    counts: screen.counts,
    span: screen.span,
    tempUnit,
    onSearch,
  };

  return (
    <div className="flex flex-col px-4 py-6 wide:px-6 desk:grid desk:grid-cols-[max-content_minmax(0,1fr)] desk:items-start desk:gap-x-8">
      {isEmpty ? undefined : (
        <div className="hidden desk:block desk:border-r desk:border-hairline desk:pr-6">
          <ClosetFilters variant="rail" {...filters} />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-6 desk:col-start-2">
        {/* `sr-only` while empty rather than hidden: out of the column's
            gap, and still in the accessibility tree, so the sentence that
            arrives is announced. */}
        <p role="status" className="m-0 text-body empty:sr-only">
          {said}
        </p>
        <div className="flex flex-col gap-2">
          <div
            data-part="grid-header"
            className="flex items-center justify-between gap-3"
          >
            <h1
              ref={focus.headingRef}
              tabIndex={-1}
              className="m-0 font-display text-title"
            >
              {isEmpty ? (
                <Bracketed>Nothing in here yet</Bracketed>
              ) : (
                closetHeading(screen.visible.length, search.group)
              )}
            </h1>
            {/* Only when there is something to show: a switch that changes
                nothing is a dead control. */}
            {screen.retiredCount > 0 ? (
              <RetiredSwitch
                count={screen.retiredCount}
                isOn={isRetiredShown}
                onToggle={setRetiredShown}
              />
            ) : undefined}
          </div>
          <FilteredLine search={search} tempUnit={tempUnit} />
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
        {isEmpty ? undefined : (
          <div className="desk:hidden">
            <ClosetFilters variant="chips" {...filters} />
          </div>
        )}
        {screen.isFiltered && screen.visible.length === 0 ? (
          <NoMatches onClear={focus.arm} />
        ) : undefined}
        <Tiles items={screen.visible} tempUnit={tempUnit} />
      </div>
    </div>
  );
}
