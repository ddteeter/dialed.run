import type { JSX, ReactNode } from "react";

import { useHydrated } from "./use-hydrated";

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
/**
 * DS3's two answers, and they were already the two widths this had — under
 * names that said how wide rather than what the surface is.
 *
 * **`panel`** is *"the phone screen, unchanged, centred at 390"*: a flow
 * step, a short form, anything that is an act. **`column`** is the reflow
 * rule — *"same markup, one column, max-width 620, **left-aligned inside
 * the page measure, not centred**, so it lines up with the wide screens'
 * primary column"*. That last clause is the whole reason the two are not
 * one prop with two numbers: they differ in alignment as well as width,
 * and only at width.
 */
type PageWidth = "panel" | "column";

const WIDTH_CLASS: Readonly<Record<PageWidth, string>> = {
  // Centred at every width. An act is a panel on the ground, and DS3 is
  // explicit that it is centred and top-aligned.
  panel: "mx-auto max-w-panel",
  // Centred on the phone, where the viewport is narrower than the measure
  // and `mx-auto` therefore does nothing; left-aligned from 720 up, where
  // it would otherwise drift away from the primary column of the two-column
  // screens beside it.
  column: "mx-auto max-w-column wide:mx-0",
};

export function Page({
  title,
  width = "column",
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
  // Onboarding renders `Page` with no `Layout`, so this is where those
  // screens get their hydration signal. Harmless when both are present —
  // the attribute is set to the same value twice.
  useHydrated();

  return (
    <div
      // `px-6` at every width, and left alone: SPACE[6] is already what
      // tokens.js asks for at width, and dropping the phone to SPACE[5] to
      // complete DS3's "SPACE[5] → SPACE[6]" would move every screen this
      // wraps on a device this lane is not here to touch.
      className={`flex w-full ${WIDTH_CLASS[width]} flex-col gap-6 px-6 py-8`}
    >
      {title === undefined ? undefined : (
        // The row is unconditional rather than appearing with `headingAction`,
        // so a heading does not shift when one is added: `justify-between`
        // with a single child puts it exactly where a block-level `h1`
        // sits. `m-0` because the column's `gap-6` owns the spacing.
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-display uppercase">{title}</h1>
          {headingAction}
        </div>
      )}
      {children}
    </div>
  );
}
