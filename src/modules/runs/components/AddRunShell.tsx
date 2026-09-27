import type { JSX, ReactNode } from "react";

/**
 * A1's page: "Add a run", as a desk page (design round 25, "Log a run is a
 * desk page").
 *
 * `Page` has DS3's two widths, and neither is this one. Below 720 it is
 * the phone column; from 720 the 620 reflow, left-aligned in the measure
 * like every column screen — *"720–1039 is the 620 reflow, not the
 * panel"*; from 1040 the 1180 measure, which the card and its rail split
 * between them. The split itself is the card's (`ParsedCard`), because
 * only it knows which of its parts is read-only.
 *
 * Hydration is stamped by the layout around it, as for every screen that
 * does not wear `Page`.
 */
export function AddRunShell({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-6 py-8 wide:mx-0 desk:max-w-page">
      <h1 className="m-0 font-display text-display uppercase">Add a run</h1>
      {children}
    </div>
  );
}
