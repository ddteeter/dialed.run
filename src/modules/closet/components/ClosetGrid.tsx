import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  garmentCategoryLabels,
  uiGroupLabels,
  uiGroups,
  type DistanceUnit,
  type TempUnit,
  type UiGroup,
} from "../../../lib/contracts";
import {
  wholeDistanceNumber,
  worksAtForms,
} from "../../../lib/contracts/measures";
import {
  Bracketed,
  Icon,
  Mono,
  PhoneBell,
  Spoken,
  useListMotion,
} from "../../../ui";
import { garmentLabel } from "../../../lib/garment-label";
import { runsLabel } from "../../../lib/runs-label";
import { isPhotoBeingChecked, photoUrlFor } from "../photo-url";
import { filterViews, railCounts, worksAtSpan } from "../filters";
import { closetSearch, type ClosetSearch } from "../inputs";
import type { ClosetItemView, ClosetListing } from "../service";
import { ClosetFilters, coverageWords } from "./ClosetFilters";
import { useIsRowFull } from "./grid-tail";
import { worksAtLabel } from "./WorksAt";

function itemLabel(view: ClosetItemView): string {
  return garmentLabel({
    name: view.item.name,
    brand: view.item.brand,
    isGeneric: view.isGeneric,
  });
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
 * Adding a garment is the grid's dashed cell (§6c.10: *"never a bar
 * action"*), and it is the last cell of the grid whatever the grid holds.
 *
 * Round 55 · 187: it follows the last tile when that row has room, at the
 * row's height. When the count fills the last row, it is one 56-tall
 * dashed row across the grid, "+ Add a piece", and an empty closet ends
 * the same way.
 */
function AddTile({ isRow }: Readonly<{ isRow: boolean }>): JSX.Element {
  return (
    <li data-part="add" className={isRow ? "col-span-full" : undefined}>
      <Link
        to="/closet/new"
        className={`target flex h-full items-center justify-center gap-2 rounded-tile border border-dashed border-hairline-2 p-3 text-body font-bold text-ink no-underline ${isRow ? "min-h-14" : ""}`}
      >
        <Icon name="add" />
        Add a piece
      </Link>
    </li>
  );
}

/**
 * A tile whose photo is being checked (R-69, round 27 #21) is tagged
 * `[CHECKING]`, as round 38 #64 amends `[ONLY YOU]`: it names a state, not
 * an audience, now that private means other runners (D-121). The brackets
 * are hidden from assistive tech and this sentence is said instead, as
 * `[UNDER REVIEW]` does. The garment's own page says who can't see it.
 */
export const CHECKING_NAME =
  "Being checked, other runners can't see this photo";

/**
 * The tile's well (Round 55 · 187, 188): square, the photo cropped to fill
 * it, or the hatch that means "no photo" with the piece's category word
 * in it, so a page of starters is still readable. Every tile's well is the
 * same square, so a mixed grid keeps its rows. The tags ride it as board
 * C's pills, top left. Decorative: the tile's link already names the
 * piece, so the word is hidden from assistive tech.
 */
function TilePhoto({ view }: Readonly<{ view: ClosetItemView }>): JSX.Element {
  const photo = photoUrlFor(view.item);
  return (
    <span
      data-part="tile-photo"
      data-state={photo === undefined ? "no-photo" : "photo"}
      className={`relative order-first flex aspect-square w-full items-center justify-center ${photo === undefined ? "photo-hatch" : "bg-photo"}`}
    >
      {photo === undefined ? (
        <span
          data-part="tile-word"
          aria-hidden="true"
          className="font-display text-heading text-muted uppercase"
        >
          {garmentCategoryLabels[view.item.category]}
        </span>
      ) : (
        <img
          src={photo}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <TileTags view={view} />
    </span>
  );
}

/**
The tile's tags, `[GENERIC]`, `[RETIRED]` and `[CHECKING]`, as pills on its photo.
*/
function TileTags({
  view,
}: Readonly<{ view: ClosetItemView }>): JSX.Element | undefined {
  const isChecking = isPhotoBeingChecked(view.item);
  if (!isChecking && !view.isGeneric && !view.item.retired) return;
  return (
    <span
      data-part="tile-tags"
      className="absolute top-2 left-2 flex flex-wrap gap-1"
    >
      {view.isGeneric ? (
        <TilePill>
          <Bracketed step="xs">Generic</Bracketed>
        </TilePill>
      ) : undefined}
      {view.item.retired ? (
        <TilePill>
          <Bracketed step="xs" className="font-semibold text-ink">
            Retired
          </Bracketed>
        </TilePill>
      ) : undefined}
      {isChecking ? (
        <TilePill part="checking-tag">
          <span aria-hidden="true">
            <Bracketed step="xs">Checking</Bracketed>
          </span>
          <span className="sr-only">{CHECKING_NAME}</span>
        </TilePill>
      ) : undefined}
    </span>
  );
}

/**
One of board C's pills on a tile's photo: chalk ground, so it reads on any photo, muted unless its tag says otherwise.
*/
function TilePill({
  part,
  children,
}: Readonly<{
  part?: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <span
      data-part={part}
      className="rounded-pill bg-ground px-2 py-1 text-muted"
    >
      {children}
    </span>
  );
}

/**
 * The tile's record (board C, Round 55 · 189): how often the piece was
 * dialed, with how far it has run once it has run a mile ("3/17 DIALED ·
 * 109 MI"), then the range it works at when it has one. Drawn "8/9
 * DIALED", said "8 of 9 runs dialed", as F's record line says it (a11y
 * judgment audit, 2026-11-04). A piece never judged says so: "No runs
 * yet" before its first run, "No verdict yet" after it. A piece with no
 * range has no range slot: "Untested" is the rail's word, not the tile's.
 */
function TileRecord({
  view,
  tempUnit,
  distanceUnit,
}: Readonly<{
  view: ClosetItemView;
  tempUnit: TempUnit;
  distanceUnit: DistanceUnit;
}>): JSX.Element {
  const summary = view.performance?.summary;
  const miles =
    summary === undefined || summary.mileageM === 0
      ? undefined
      : `${wholeDistanceNumber(summary.mileageM, distanceUnit)} ${distanceUnit}`;
  const range =
    view.tempRange === undefined
      ? undefined
      : worksAtForms(view.tempRange, tempUnit);
  return (
    <>
      <span data-part="tile-record" className="text-muted">
        <Mono step="xs">
          <DialedCount summary={summary} />
          {miles === undefined ? undefined : ` · ${miles}`}
        </Mono>
      </span>
      {/* **Muted, never teal.** T2: teal means *dialed* — a verdict — and
          a garment's working range is not one. Board C draws the band line
          in `--muted`, and round 16 says coverage is monochrome. */}
      {range === undefined ? undefined : (
        <span data-part="tile-range" className="text-muted">
          <Bracketed step="xs">
            <Spoken {...range} />
          </Bracketed>
        </span>
      )}
    </>
  );
}

function DialedCount({
  summary,
}: Readonly<{
  summary: NonNullable<ClosetItemView["performance"]>["summary"] | undefined;
}>): JSX.Element {
  if (summary === undefined) return <>No runs yet</>;
  if (summary.verdictCount === 0) return <>No verdict yet</>;
  const dialed = String(summary.dialedCount);
  const judged = String(summary.verdictCount);
  return (
    <>
      <span aria-hidden="true">{`${dialed}/${judged} dialed`}</span>
      <span className="sr-only">{`${dialed} of ${runsLabel(summary.verdictCount)} dialed`}</span>
    </>
  );
}

/**
 * One garment's tile, as board C draws it: the photo, then the name, the
 * record, and the range with the mileage.
 *
 * A retired tile is otherwise **the same tile, no dimming**: *"retired is
 * a fact, not a disabled state."* The photo sits above the name on screen
 * but after it in the markup (`order-first`), so the link's accessible
 * name still starts with what the piece is called. MOST DIALED and
 * RETIRE?, the board's computed badges, wait with its sort (R46·109m).
 */
function Tile({
  view,
  tempUnit,
  distanceUnit,
}: Readonly<{
  view: ClosetItemView;
  tempUnit: TempUnit;
  distanceUnit: DistanceUnit;
}>): JSX.Element {
  return (
    <Link
      to="/closet/$itemId"
      params={{ itemId: view.item.id }}
      className="target row-press flex h-full flex-col overflow-hidden rounded-tile border border-hairline bg-panel no-underline"
    >
      <span className="flex flex-col gap-1 p-3">
        {/* Round 55 · 187: two lines, always reserved, so every tile is one
            height and the record lines line up; a longer name ends in an
            ellipsis and is still said whole, as the link's name. */}
        <span
          data-part="tile-name"
          className="line-clamp-2 text-body font-semibold [min-block-size:2lh]"
        >
          {itemLabel(view)}
        </span>
        <TileRecord
          view={view}
          tempUnit={tempUnit}
          distanceUnit={distanceUnit}
        />
      </span>
      <TilePhoto view={view} />
    </Link>
  );
}

interface TilesProps {
  items: readonly ClosetItemView[];
  tempUnit: TempUnit;
  distanceUnit: DistanceUnit;
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
  tempUnit,
  distanceUnit,
}: Readonly<TilesProps>): JSX.Element {
  const { shown, leaving, listRef } = useListMotion(items, itemKey);
  const isRowFull = useIsRowFull(listRef, items.length);
  return (
    <ul
      ref={listRef}
      data-part="grid"
      // DS3's reflow rule for a grid of garments, verbatim: "grids of runs
      // or garments go from 2 tracks to `auto-fill, minmax(180px, 1fr)`".
      // Two tracks on the phone at every count (Round 55 · 188): two
      // 180px tracks and the gap do not fit 358px, so auto-fill alone
      // gave one.
      className="m-0 grid list-none grid-cols-2 gap-3 p-0 wide:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
    >
      {shown.map((view) => (
        <li
          key={view.item.id}
          className="collapsing-row"
          data-leaving={leaving.has(view.item.id) ? "true" : undefined}
        >
          <Tile view={view} tempUnit={tempUnit} distanceUnit={distanceUnit} />
        </li>
      ))}
      <AddTile isRow={isRowFull} />
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
  The runner's distance unit, for each tile's mileage.
  */
  distanceUnit: DistanceUnit;
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
  const { coverage } = search;
  if (range === undefined && coverage === undefined) return;
  return (
    <p data-part="filtered" className="m-0 text-label">
      <Mono step="xs">Filtered: </Mono>
      {range === undefined ? undefined : (
        <Bracketed step="xs">
          <Spoken {...range} />
        </Bracketed>
      )}
      {range === undefined || coverage === undefined ? undefined : (
        <Mono step="xs">{" · "}</Mono>
      )}
      {coverage === undefined ? undefined : (
        <Mono step="xs">{coverageWords[coverage]}</Mono>
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
      <Link
        to="/closet"
        activeOptions={{ exact: true }}
        onClick={onClear}
        // Underlined: inside a sentence, colour alone does not say "link".
        className="target text-ink underline"
      >
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
    // Equivalent without `?.`: the h1 is drawn on every render, so the ref
    // is always set by the time an effect runs. The `?.` is the type's.
    // Stryker disable next-line OptionalChaining
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
 * Board C's nudge, "14 OF 15 pieces are still generic. Name the ones you
 * reach for." It counts the pieces the grid is showing, as the heading
 * does, so the two never disagree under a filter or with retired pieces
 * hidden (C-13, N1-05).
 */
function GenericNudge({
  visible,
}: Readonly<{ visible: readonly ClosetItemView[] }>) {
  const generic = visible.filter((view) => view.isGeneric).length;
  if (generic === 0) return;
  return (
    <p data-part="generic-nudge" className="m-0 text-small text-quiet">
      <Mono>
        {generic} of {visible.length}
      </Mono>{" "}
      pieces are still generic. Name the ones you reach for.
    </p>
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
  distanceUnit,
  search: routed = NO_SEARCH,
  onSearch,
}: Readonly<ClosetGridProps>) {
  // The router hands every route the whole query, its own parsed fields
  // merged over the raw ones, so a GET from WORKS AT's form still carries
  // `lowest`, `highest` and `unit` here beside the Celsius they made, and
  // every link built from it would carry them on — `Any` landing on a URL
  // that brings the span straight back (e2e, design 174). Parsed again,
  // which keeps what they made and drops them.
  const search = closetSearch({ ...routed });
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
    // Round 54 · 168.2: the closet is the column rule's exception, its grid
    // on MEASURE.page and centred. The rail's track only exists beside a
    // rail: an empty closet has none, and an empty track still cost its gap
    // (C-10). Round 55 · 185 keeps the 16 phone gutter.
    <div
      className={`mx-auto flex w-full max-w-page flex-col px-4 py-6 wide:px-6 ${isEmpty ? "" : "desk:grid desk:grid-cols-[max-content_minmax(0,1fr)] desk:items-start desk:gap-x-8"}`}
    >
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
                nothing is a dead control. Then the phone's bell, the row's
                last thing (Design 169.1). */}
            <div className="flex items-center gap-3">
              {screen.retiredCount > 0 ? (
                <RetiredSwitch
                  count={screen.retiredCount}
                  isOn={isRetiredShown}
                  onToggle={setRetiredShown}
                />
              ) : undefined}
              <PhoneBell />
            </div>
          </div>
          <FilteredLine search={search} tempUnit={tempUnit} />
          {isEmpty ? (
            <p className="m-0 text-body text-quiet">
              Add what you run in most. Three pieces is enough to start.
            </p>
          ) : undefined}
          <GenericNudge visible={screen.visible} />
        </div>
        {isEmpty ? undefined : (
          <div className="desk:hidden">
            <ClosetFilters variant="chips" {...filters} />
          </div>
        )}
        {screen.isFiltered && screen.visible.length === 0 ? (
          <NoMatches onClear={focus.arm} />
        ) : undefined}
        <Tiles
          items={screen.visible}
          tempUnit={tempUnit}
          distanceUnit={distanceUnit}
        />
      </div>
    </div>
  );
}
