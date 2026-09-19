import type { JSX } from "react";

import type { FabricPart } from "../../../lib/contracts";
import { Mono } from "../../../ui";

/**
 * What a garment is made of — design round 10 §AG, and **garment detail
 * only.**
 *
 * Design's reason for the one placement, which is also why there is no
 * prop to relax it: *"the closet is for finding. Four-line compositions
 * under every card make the grid a spec sheet and bury the range, which is
 * the number that decides what you wear."* Not the grid, not a filter, not
 * the Call — §AG rules 03 and 04.
 *
 * **The values are the brand's own text.** No normalising "elastane" to
 * "spandex", no reordering by percentage, no summing to check it reaches
 * 100. A "merino" filter is post-v1 and needs normalised fibres, which is
 * the parser round 5 refused. So this component formats and never
 * interprets: the only thing it composes is the `87% polyester` pair, and
 * a part with no percentage prints the material alone rather than
 * inventing one.
 *
 * Numbers are deliberately **not** mono here, which is the one place this
 * screen departs from the brand's usual tell. §AG: *"a percentage on a
 * label is a claim, not a measurement."* Mono means a sensor or a clock
 * measured it; a hang tag did not.
 */
export interface Composition {
  /**
   * `products.fabric_composition` — as published, character for character.
   */
  readonly verbatim: string | undefined;
  /**
   * `products.fabric_parts`, parsed. Labelled rows when there is more than
   * one.
   */
  readonly parts: readonly FabricPart[];
  /**
   * Whose label it is. The footer is omitted rather than guessing.
   */
  readonly brand: string | undefined;
}

/**
 * `87% polyester · 13% elastane`, or `nylon` when the label gave no split.
 */
function materialsLine(part: FabricPart): string {
  return part.materials
    .map((material) =>
      material.pct === undefined
        ? material.material
        : `${String(material.pct)}% ${material.material}`,
    )
    .join(" · ");
}

/**
 * §AG rule 01, and it is a three-way rather than a two-way: more than one
 * part gives labelled rows in the brand's order; otherwise the verbatim
 * line; both absent gives **no block at all**, not an "Unknown" row.
 *
 * "Both absent" includes a single unlabelled part, which is what one-line
 * compositions arrive as — `parts` carrying one entry and `verbatim`
 * carrying the same sentence better.
 */
export function CompositionBlock({
  composition,
}: Readonly<{ composition: Composition }>): JSX.Element | undefined {
  const { verbatim, parts, brand } = composition;
  const hasLabelledParts = parts.length > 1;
  if (!hasLabelledParts && verbatim === undefined) return undefined;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-muted">
        <Mono step="xs">Made of</Mono>
      </h2>
      {hasLabelledParts ? (
        <dl className="m-0 flex flex-col gap-2">
          {parts.map((part, index) => (
            <div
              // The brand's order is the order, so a part's position is
              // part of its identity — two "PANELS" rows are legal and are
              // not the same row.
              key={`${part.part ?? ""}-${String(index)}`}
              className="flex flex-col gap-1"
            >
              {part.part === undefined ? undefined : (
                <dt className="m-0 text-muted">
                  <Mono step="xs">{part.part}</Mono>
                </dt>
              )}
              <dd className="m-0 text-body">{materialsLine(part)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-body">{verbatim}</p>
      )}
      {brand === undefined ? undefined : (
        <p className="m-0 text-muted">
          <Mono step="xs">As labelled by {brand}</Mono>
        </p>
      )}
    </section>
  );
}
