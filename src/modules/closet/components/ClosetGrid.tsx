import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Bracketed, Mono } from "../../../ui";
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

  if (listing.totalCount === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-body text-quiet">
          Nothing in here yet. Add the five things you actually reach for — the
          rest can wait.
        </p>
        <Link
          to="/closet/new"
          className="mt-6 inline-block rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
        >
          Add a piece
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-4 py-6 wide:px-6">
      {listing.genericCount > 0 ? (
        <p className="rounded-none bg-tint px-4 py-3 text-small text-quiet">
          <Mono>
            {listing.genericCount} of {listing.totalCount}
          </Mono>{" "}
          pieces are still generic. Name the ones you reach for.
        </p>
      ) : undefined}

      {GROUP_ORDER.map(({ group, label }) => {
        const items = visible.filter((view) => view.uiGroup === group);
        if (items.length === 0) return;
        return (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="font-display text-heading">{label}</h2>
            <ul className="grid grid-cols-2 gap-3 wide:grid-cols-3 desk:grid-cols-4">
              {items.map((view) => (
                <li key={view.item.id}>
                  <Link
                    to="/closet/$itemId"
                    params={{ itemId: view.item.id }}
                    className="flex flex-col gap-1 rounded-field border border-hairline bg-panel p-3 no-underline"
                  >
                    <span className="text-body font-semibold text-ink">
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
      })}

      {retiredCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setShowRetired((value) => !value);
          }}
          className="self-start text-muted"
        >
          <Mono step="sm">
            {showRetired ? "Hide" : "Show"} retired ({retiredCount})
          </Mono>
        </button>
      ) : undefined}
    </div>
  );
}
