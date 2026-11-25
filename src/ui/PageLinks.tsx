import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

/**
 * A Desk list's way past its page and back (owner, 2026-11-24): "Next
 * {n} →" while there is a next page, and the back label from any page but
 * the first, each re-reading the list's own route with a new `after`. A
 * page with a next one is always full, so `shown` is the page's size.
 * Drawn as ink underlined targets on one wrapping line.
 */
export function PageLinks({
  to,
  shown,
  next,
  after,
  backLabel,
}: Readonly<{
  /**
  The list's route: Access's requests, or Review's removal requests.
  */
  to: "/desk/access" | "/desk/review";
  shown: number;
  /**
  The next page's `after`, or nothing on the last page.
  */
  next: string | undefined;
  /**
  This page's `after`, or nothing on the first.
  */
  after: string | undefined;
  backLabel: string;
}>): JSX.Element | undefined {
  if (next === undefined && after === undefined) return undefined;
  return (
    <p className="m-0 flex flex-wrap gap-x-6">
      {after === undefined ? undefined : (
        <Link to={to} className={PAGE_LINK_CLASS}>
          {backLabel}
        </Link>
      )}
      {next === undefined ? undefined : (
        <Link to={to} search={{ after: next }} className={PAGE_LINK_CLASS}>
          {`Next ${String(shown)} →`}
        </Link>
      )}
    </p>
  );
}

const PAGE_LINK_CLASS =
  "target inline-flex items-center text-ink underline underline-offset-4";

/**
 * What a paged list's route loader depends on: the search's `after`
 * alone, so the page is read again exactly when it changes.
 */
export function afterOf({
  search,
}: Readonly<{ search: Readonly<{ after?: string | undefined }> }>): {
  after: string | undefined;
} {
  return { after: search.after };
}
