import { Link, type LinkProps } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { PendingLabel } from "./form";
import { PAGE_ONLY } from "./tabs";

/**
 * A tab's label: the word, or — once its screen has taken over 300ms — the
 * word with breathing brackets.
 *
 * Only while waiting, so a resting tab's text is its label and nothing else.
 */
export function TabLabel({
  label,
  waiting,
}: Readonly<{ label: string; waiting: boolean }>): JSX.Element {
  return waiting ? (
    <PendingLabel label={label} pendingLabel={label} pending />
  ) : (
    <>{label}</>
  );
}

/**
 * One bar destination, shared by the phone bar and the wide one: a list item
 * holding a `Link`. What differs between the bars (the item's class, the two
 * link classes, and what sits inside the link) is passed in; what must not
 * differ is here once.
 *
 * `aria-current` is ours on a lit tab and the router's on the page itself:
 * `Link` spreads `"page"` last, and `PAGE_ONLY` limits that to the tab's own
 * path. Everywhere else a lit tab — beneath its page, or held under the log
 * flow — says `"true"`.
 *
 * `"true"` and never `"page"`, per the Accessibility Contract's round-12 row:
 * the held tab is the current item in the set, and the runner is not on it.
 * Claiming the page would send somebody to the wrong screen.
 */
export function TabItem({
  to,
  active,
  itemClass,
  activeClass,
  restingClass,
  children,
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  /**
  Lit: the runner is on this tab's page, beneath it, or in a flow over it.
  */
  active: boolean;
  itemClass: string;
  activeClass: string;
  restingClass: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <li className={itemClass}>
      <Link
        to={to}
        activeOptions={PAGE_ONLY}
        aria-current={active ? "true" : undefined}
        className={active ? activeClass : restingClass}
      >
        {children}
      </Link>
    </li>
  );
}
