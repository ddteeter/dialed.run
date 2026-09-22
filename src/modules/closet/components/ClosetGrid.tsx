import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import { Bracketed, Mono, useListMotion } from "../../../ui";
import type { UiGroup } from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/thermal";
import { garmentLabel } from "../label";
import type { ClosetItemView, ClosetListing } from "../service";

/**
 * Screen C group order (docs/contracts.md derived-UI-groups table).
 */
const GROUP_ORDER: { group: UiGroup; label: string }[] = [
  { group: "tops", label: "Tops" },
  { group: "bottoms", label: "Bottoms" },
  { group: "outer", label: "Outer" },
  { group: "hands_head", label: "Hands / head" },
  { group: "shoes", label: "Shoes" },
  { group: "socks_extras", label: "Socks / extras" },
];

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
 * One derived-UI group of the grid, and the two list surfaces the
 * doctrine gives it.
 *
 * Its own component because `useListMotion` is a hook and the groups are a
 * `map` — but also because the group is the unit that animates: a garment
 * only ever reflows among its own kind, and a group whose last piece was
 * retired should close up rather than leave a heading over nothing.
 *
 * It renders `shown` rather than `items` so a row that has stopped
 * matching the filter is still on screen while it collapses. That is the
 * whole of "retire, don't delete" expressed as a move: the row folds shut
 * where it stood instead of blinking out.
 */
function ClosetGroup({
  label,
  items,
}: Readonly<{
  label: string;
  items: readonly ClosetItemView[];
}>): JSX.Element | undefined {
  const { shown, leaving, listRef } = useListMotion(items, itemKey);
  if (shown.length === 0) return undefined;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-heading">{label}</h2>
      <ul
        ref={listRef}
        // DS3's reflow rule for a grid of garments, verbatim: "grids of
        // runs or garments go from 2 tracks to `auto-fill, minmax(180px,
        // 1fr)`". One rule instead of three fixed counts, which also
        // means the grid does not have to be told that the filter rail
        // has taken a third of the row from it at desk.
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
      >
        {shown.map((view) => (
          <li
            key={view.item.id}
            className="collapsing-row"
            data-leaving={leaving.has(view.item.id) ? "true" : undefined}
          >
            <Link
              to="/closet/$itemId"
              params={{ itemId: view.item.id }}
              className="target row-press flex flex-col gap-1 rounded-field border border-hairline bg-panel p-3 no-underline"
            >
              <span className="text-body font-semibold">
                {itemLabel(view)}
                {view.isGeneric ? (
                  <>
                    {" "}
                    <Bracketed step="xs">Generic</Bracketed>
                  </>
                ) : undefined}
                {view.item.retired ? (
                  <>
                    {" "}
                    <Bracketed step="xs">Retired</Bracketed>
                  </>
                ) : undefined}
              </span>
              <Bracketed className="text-dialed-text">
                {tempLabel(view)}
              </Bracketed>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Screen C's heading row.
 *
 * It moved out of `src/routes/closet/index.tsx` so the empty state can
 * drop the "Add" beside it without the route branching. `headingAction`
 * on `Page` could not serve: this screen does not wear `Page`, because
 * the grid owns its own two-column layout at desk.
 */
function ClosetHeading({
  action,
}: Readonly<{ action?: boolean }>): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <h1 className="font-display text-title uppercase">The Closet</h1>
      {action === true ? (
        <Link
          to="/closet/new"
          className="target inline-flex items-center rounded-pill bg-ink px-3 py-2 text-body font-semibold text-ground"
        >
          Add
        </Link>
      ) : undefined}
    </div>
  );
}

export interface ClosetGridProps {
  listing: ClosetListing;
  /**
  Open with retired items shown. Set after retiring one, so the user lands
  on the item still present and marked, rather than on a grid it has just
  vanished from.
  */
  initialShowRetired?: boolean;
}

/**
 * Screen C: the closet grid, grouped by the derived UI groups, with the
 * quiet enrichment nudge (D-27/D-28) and retired items behind a toggle.
 *
 * **One of the two screens the Desktop Contract lets go two-column**
 * (DS4: "only at desk, only for Feed X, Closet C and the verdict
 * backlog"; round 15 kept Closet and dropped Feed for v1). What C calls
 * the filter rail, this closet has as two controls — the generic nudge
 * and the retired toggle — so the rail holds those and invents nothing.
 * When the closet grows real filters they have a place to go.
 */
export function ClosetGrid({
  listing,
  initialShowRetired = false,
}: Readonly<ClosetGridProps>) {
  const [showRetired, setShowRetired] = useState(initialShowRetired);

  const visible = listing.items.filter(
    (view) => showRetired || !view.item.retired,
  );
  const retiredCount = listing.items.filter((view) => view.item.retired).length;

  // **The empty closet offers one Add, not two.** The heading's "Add" and
  // this one are the same action a few inches apart, and on an empty
  // closet the centred one is the whole screen's point — so the heading
  // keeps the title and drops the control. The heading lives here rather
  // than in the route precisely so this can be decided: a route may not
  // branch (`server-functions-are-glue`), and "which control a state
  // shows" is exactly the kind of decision that rule wants somewhere a
  // test can reach. Owner's read, 2026-09-21.
  if (listing.totalCount === 0) {
    return (
      <div className="flex flex-col gap-6 px-4 pt-6 wide:px-6">
        <ClosetHeading />
        <div className="py-12 text-center">
          <p className="text-body text-quiet">
            Nothing in here yet. Add the five things you actually reach for —
            the rest can wait.
          </p>
          <Link
            to="/closet/new"
            className="target mt-6 inline-block rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
          >
            Add a piece
          </Link>
        </div>
      </div>
    );
  }

  return (
    // DS3's Closet row: "filter rail left, garment grid right. **Below
    // 1040 the filter rail becomes the phone's filter chips above a
    // reflowed grid**" — which is what a single-column flex layout below
    // `desk:` already is, so the rail costs one grid declaration and no
    // second arrangement of the same parts.
    //
    // The ratio is DS4's ("1.55fr / 1fr, gap SPACE[6]") with the columns
    // in C's order. A ratio, not a width: nothing here pins a number that
    // is not in MEASURE.
    <div className="flex flex-col gap-6 px-4 py-6 wide:px-6">
      <ClosetHeading action />
      <div className="flex flex-col gap-8 desk:grid desk:grid-cols-[1fr_1.55fr] desk:items-start desk:gap-6">
      <div
        data-slot="closet-rail"
        className="flex flex-col gap-4 desk:sticky desk:top-6"
      >
        {listing.genericCount > 0 ? (
          <p className="rounded-none bg-tint px-4 py-3 text-small text-quiet">
            <Mono>
              {listing.genericCount} of {listing.totalCount}
            </Mono>{" "}
            pieces are still generic. Name the ones you reach for.
          </p>
        ) : undefined}

        {retiredCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setShowRetired((value) => !value);
            }}
            className="target self-start text-muted"
          >
            <Mono step="sm">
              {showRetired ? "Hide" : "Show"} retired ({retiredCount})
            </Mono>
          </button>
        ) : undefined}
      </div>

        <div className="flex flex-col gap-8">
          {GROUP_ORDER.map(({ group, label }) => (
            <ClosetGroup
              key={group}
              label={label}
              items={visible.filter((view) => view.uiGroup === group)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
