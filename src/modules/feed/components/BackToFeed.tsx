import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Icon } from "../../../ui";

/**
 * The back arrow to the feed, on D and on a runner's page. Icon-only, so
 * its name is its meaning (R57·255a).
 *
 * `exact`: the router marks a prefix match `aria-current="page"`, and
 * these pages sit under /feed, so back is never here.
 */
export function BackToFeed(): JSX.Element {
  return (
    <Link
      to="/feed"
      activeOptions={{ exact: true }}
      aria-label="Back to feed"
      className="target inline-flex items-center text-ink"
    >
      <Icon name="back" size={20} />
    </Link>
  );
}
