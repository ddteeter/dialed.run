import type { JSX, ReactNode } from "react";

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
 * Whether there is a block to draw: §AG rule 01's "both absent gives no
 * block at all". The detail page asks first, so a piece with nothing to
 * show has no section, and its WRONG? › stands alone there (R-74).
 */
export function hasComposition(
  composition: Pick<Composition, "parts" | "verbatim">,
): boolean {
  return composition.parts.length > 1 || composition.verbatim !== undefined;
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
  source,
  wrong,
}: Readonly<{
  composition: Composition;
  /**
   * The site whose page it was read from, when it was (round 43 #94): the
   * kicker names it, since a runner cannot override a composition and so
   * should know whose it is. Absent, the kicker is the plain "Made of".
   */
  source?: string | undefined;
  /**
   * §AG's WRONG? ›, at the end of the "As labelled by" line, when the
   * piece is a shared product a runner can correct (R-74).
   */
  wrong?: ReactNode;
}>): JSX.Element {
  const { verbatim, parts, brand } = composition;
  const hasLabelledParts = parts.length > 1;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-muted">
        {source === undefined ? (
          <Mono step="xs">Made of</Mono>
        ) : (
          <Mono step="xs">
            Composition · from <span className="normal-case">{source}</span>
          </Mono>
        )}
      </h2>
      {/* Round 55 · 191e: "As labelled by" sits tight under what it
          credits, not midway to the next line. */}
      <div className="flex flex-col gap-1">
        {hasLabelledParts ? (
          // Round 55 · 191a: AG1's two-column table, the part's label
          // beside what it is made of. A part with no label keeps the
          // value column.
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
            {parts.map((part, index) => (
              <div
                // The index, because the brand's order *is* the order: this
                // list is parsed once per render and never sorted, filtered
                // or appended to, so position is stable and is the only
                // thing that distinguishes two "PANELS" rows from each
                // other. A key built from the label would collide on
                // exactly that case.
                key={index}
                className="col-span-2 grid grid-cols-subgrid items-baseline"
              >
                {part.part === undefined ? undefined : (
                  <dt className="m-0 text-muted">
                    <Mono step="xs">{part.part}</Mono>
                  </dt>
                )}
                <dd className="col-start-2 m-0 text-body">
                  {materialsLine(part)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-body">{verbatim}</p>
        )}
        {brand === undefined && wrong === undefined ? undefined : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {brand === undefined ? undefined : (
              <p className="m-0 text-muted">
                <Mono step="xs">As labelled by {brand}</Mono>
              </p>
            )}
            {wrong}
          </div>
        )}
      </div>
    </section>
  );
}
