import { Link, type LinkProps } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "./Mono";

/**
 * One tab.
 *
 * The five used to be written out, on the stated grounds that TanStack
 * checks route paths as literals and "widening them into a shared `string`
 * field would defeat that check". The first half is true and the second is
 * not: `LinkProps["to"]` is the generated union of real routes, not
 * `string`, so a typo here is still a type error — measured, with a made-up
 * path that tsc rejected through this exact prop.
 *
 * It is extracted now because the tab label became a `<Mono step="sm">`,
 * which pushed five identical four-line blocks past the clone gate. They
 * were a clone before that and simply short enough to hide.
 */
function Tab({
  to,
  label,
}: Readonly<{ to: NonNullable<LinkProps["to"]>; label: string }>): JSX.Element {
  return (
    <li>
      <Link to={to} className="text-muted no-underline">
        <Mono step="sm">{label}</Mono>
      </Link>
    </li>
  );
}

/**
 * The five-tab shell footer (docs/product.md §Navigation). Every tab points
 * at its own route; D-31 is what is left here, and wants its own change
 * because a tab bar growing glyphs is worth a demo of its own.
 */
export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-hairline bg-ground pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="m-0 flex list-none justify-between px-5 py-4">
        <Tab to="/feed" label="Feed" />
        <Tab to="/closet" label="Closet" />
        <Tab to="/runs/new" label="+ Add" />
        <Tab to="/call" label="Call" />
        {/* Points at lane 104's own profile route until a `you/` lane exists. */}
        <Tab to="/feed/me" label="You" />
      </ul>
    </nav>
  );
}
