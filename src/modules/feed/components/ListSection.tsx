import type { JSX, ReactNode } from "react";

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
 */
export function ListSection<TItem>({
  title,
  items,
  children,
}: Readonly<{
  title: string;
  items: readonly TItem[];
  /**
  Renders one row, `<li key=…>` and all.
  */
  children: (item: TItem) => ReactNode;
}>): JSX.Element | undefined {
  if (items.length === 0) return undefined;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase">{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => children(item))}
      </ul>
    </div>
  );
}
