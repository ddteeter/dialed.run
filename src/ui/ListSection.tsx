import type { JSX, ReactNode } from "react";

import { Bracketed } from "./Bracketed";

/**
 * A titled list that is absent rather than empty.
 *
 * `OwnProfile` wrote this three times — temperature coverage, most worn,
 * recent entries — and `EntryDetail` a fourth, for the kit. Every one was
 * the same `length === 0 ? undefined :` guard around the same heading and
 * the same `<ul>`, differing only in the title and what a row looks like.
 * `semantic` mode reports three of the four pairings.
 *
 * **Absent, not empty, and that is the behaviour worth keeping.** These sit
 * in a `flex flex-col gap-*` column, so a section that rendered an empty
 * `<ul>` would still take a gap with it — a blank band under a heading for
 * a profile that has nothing to show yet. Returning `undefined` is what
 * makes a new account's profile close up rather than gap out.
 *
 * The row is a render prop rather than a `rows` array because each caller's
 * `<li>` carries its own key and its own shape; handing them a `key` to
 * apply would be one more thing four call sites could get wrong.
 *
 * **`whenEmpty` is the other half, and the reason this lives in `ui/`.**
 * On a profile, nothing-to-show should close up. On W2's blocked list and
 * the review queue the empty state IS the screen — "Nobody. That's
 * normal." is the artboard's own point — so those pass a node and get it
 * rendered instead of the list. Two behaviours, one primitive: the
 * alternative was a second component in `modules/safety` that a clone
 * detector would rightly call a copy of this one.
 */
export function ListSection<TItem>({
  title,
  items,
  count,
  whenEmpty,
  children,
}: Readonly<{
  title: string;
  items: readonly TItem[];
  /**
   * Shows `[N title]` above the list in bracket notation — the measured-
   * value tell (docs/product.md §Brand). Both surfaces whose empty state
   * is the point also want the count, and writing it at each call site is
   * what made them read as copies of one another.
   */
  count?: boolean;
  /**
   * What to show instead of the list when there is nothing in it. Omitted,
   * the section renders nothing at all.
   */
  whenEmpty?: ReactNode;
  /**
  Renders one row, `<li key=…>` and all.
  */
  children: (item: TItem) => ReactNode;
}>): JSX.Element | undefined {
  const heading =
    count === true ? (
      <h2 className="text-sm font-semibold uppercase">
        <Bracketed>
          {String(items.length)} {title}
        </Bracketed>
      </h2>
    ) : (
      <h2 className="text-sm font-semibold uppercase">{title}</h2>
    );

  if (items.length === 0) {
    if (whenEmpty === undefined) return undefined;
    return (
      <div className="flex flex-col gap-2">
        {heading}
        {whenEmpty}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {heading}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => children(item))}
      </ul>
    </div>
  );
}
