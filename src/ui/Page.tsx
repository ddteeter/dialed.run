import type { JSX, ReactNode } from "react";

/**
 * The column an authenticated page's content sits in, and its heading.
 *
 * Seven routes had written this out by hand — the same `mx-auto flex
 * w-full max-w-* flex-col gap-6 px-6 py-8` column and, in six of them, the
 * same `m-0 font-display text-3xl uppercase leading-none` heading. They
 * differed in three things and nothing else: how wide the column is, what
 * the heading says, and whether something sits opposite the heading.
 * Those three are the props.
 *
 * `Layout` is still the caller's to supply, and deliberately: it takes the
 * notification bell, which lives in `modules/notifications`, and `ui/` is
 * foundation that may not import from `modules/` (CLAUDE.md architecture
 * rules; enforced by dependency-cruiser). So a route wears `Layout` on the
 * outside and this on the inside.
 */
type PageWidth = "wide" | "narrow";

/**
 * `wide` is the reading column (feed, runs, notifications); `narrow` is
 * the one a short form sits in (log a run, import status, Strava). Both
 * were already in use — this names them rather than inventing a third.
 */
const WIDTH_CLASS: Readonly<Record<PageWidth, string>> = {
  wide: "max-w-xl",
  narrow: "max-w-sm",
};

export function Page({
  title,
  width = "wide",
  headingAction,
  children,
}: Readonly<{
  /**
   * Omitted by a page whose own content owns the heading — run detail is
   * the one, where `RunDetail` renders it.
   */
  title?: string | undefined;
  width?: PageWidth | undefined;
  /**
   * Sits opposite the heading, e.g. the "+ Add" link on Runs.
   *
   * Not named `action`: the typed-routing lint rule matches any `/…`
   * literal *descended from* a `href`/`action` JSX attribute, which is
   * `<form action="/url">` — the thing it exists to catch. A `<Link
   * to="/runs/new">` passed through a prop of that name trips it, and the
   * rule is right to be suspicious of the name rather than wrong about
   * this case.
   */
  headingAction?: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div
      className={`mx-auto flex w-full ${WIDTH_CLASS[width]} flex-col gap-6 px-6 py-8`}
    >
      {title === undefined ? undefined : (
        // The row is unconditional rather than appearing with `headingAction`,
        // so a heading does not shift when one is added: `justify-between`
        // with a single child puts it exactly where a block-level `h1`
        // sits. `m-0` because the column's `gap-6` owns the spacing.
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-3xl uppercase leading-none">
            {title}
          </h1>
          {headingAction}
        </div>
      )}
      {children}
    </div>
  );
}
