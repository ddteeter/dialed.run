import type { JSX, ReactNode } from "react";

import { Mono } from "../../../ui";

/*
 * Its own file, apart from `HandleForm.tsx`, because Settings › Username
 * renders the form under `SettingsSubPage`'s own heading — and a screen has
 * one h1 (Accessibility Contract rule 04), which `one-h1-per-route` counts
 * file by file along the imports.
 */

/**
 * O0's head: the step kicker over the question (round 26 #7, "STEP 1 OF 4
 * · What should runners call you?"). The page's own heading, because the
 * kicker sits above it and `Page`'s `title` has nowhere to put one.
 */
export function HandleStep({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Mono step="xs" className="text-muted">
          Step 1 of 4
        </Mono>
        <h1 className="m-0 font-display text-display uppercase">
          What should runners call you?
        </h1>
      </div>
      {children}
    </div>
  );
}
