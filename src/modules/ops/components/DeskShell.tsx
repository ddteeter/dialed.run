import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Mono, Page, Wordmark } from "../../../ui";
import type { DeskToday } from "../desk";

/**
 * The Desk's shell (Operator Screens D0; decision D-35). Always dark
 * whatever the operator's theme — it is a tool, not the product — with
 * hi-viz as its only accent, a left rail the runner app never has, and no
 * link to or from the runner app.
 *
 * `data-ground="night"` is T1's dark column in both themes (design 185):
 * it redefines every ground-relative role, so the tokens below mean
 * "against ink" without a second palette, and it reads nothing from the
 * page. Not `ink`, the inverted block, which turns to paper on a dark page
 * (T2 rule 04): T3 says the Desk "doesn't read the runner's theme".
 */

/**
 * Every destination the rail names, in D-87's order (Operator Screens D0,
 * redrawn in round 30). Gave up is not one: it is a section of Today, and
 * Today's rail count is its count.
 */
const DESK_PAGES = [
  "today",
  "review",
  "access",
  "duplicates",
  "runners",
] as const;

export type DeskPage = (typeof DESK_PAGES)[number];

const LABEL: Readonly<Record<DeskPage, string>> = {
  today: "Today",
  review: "Review",
  access: "Access",
  duplicates: "Duplicates",
  runners: "Runners",
};

/**
 * Where each destination lives. Every one is built now (Duplicates was
 * the last, task 110), so the rail has no placeholder entry and a new
 * page cannot be named without a route to go with it.
 */
const HREF: Readonly<
  Record<
    DeskPage,
    | "/desk"
    | "/desk/review"
    | "/desk/runners"
    | "/desk/access"
    | "/desk/duplicates"
  >
> = {
  today: "/desk",
  review: "/desk/review",
  access: "/desk/access",
  duplicates: "/desk/duplicates",
  runners: "/desk/runners",
};

/**
A rail count and what it counts. The words are for a screen reader only:
the rail draws the bare number, and "Review 4" alone does not say four of
what (a11y judgment audit, 2026-11-04).
*/
type RailTally = Readonly<{ count: number; counts: string }>;

/**
A count that needs a person is hi-viz; at zero it is not shown at all.
*/
function RailCount({ tally }: Readonly<{ tally: RailTally | undefined }>) {
  if (tally === undefined || tally.count === 0) return;
  return (
    <>
      <Mono step="sm" className="text-hiviz-text">
        {tally.count}
      </Mono>
      <span className="sr-only"> {tally.counts}</span>
    </>
  );
}

function RailEntry({
  page,
  label,
  current,
  tally,
}: Readonly<{
  page: DeskPage;
  label: string;
  current: DeskPage;
  tally: RailTally | undefined;
}>) {
  const isActive = page === current;
  const tone = isActive ? "text-hiviz-text" : "text-ink";
  const content = (
    <>
      <span>{label}</span>
      <RailCount tally={tally} />
    </>
  );
  return (
    <li>
      <Link
        to={HREF[page]}
        // Exact: by default Link marks a prefix match current, so Today
        // ("/desk") read as the current page on every Desk page. The
        // Link sets aria-current itself whenever it matches.
        activeOptions={{ exact: true }}
        aria-current={isActive ? "page" : undefined}
        className={`target flex items-baseline justify-between gap-6 ${tone}`}
      >
        {content}
      </Link>
    </li>
  );
}

export function DeskShell({
  current,
  today,
  children,
}: Readonly<{
  current: DeskPage;
  /**
  The `/desk` layout's loader data: every page under it has it.
  */
  today: DeskToday;
  children: ReactNode;
}>) {
  // Only a destination that needs a person carries a count: Review's is
  // what waits for a decision, Today's what the system gave up on.
  const tallies: Partial<Record<DeskPage, RailTally>> = {
    today: { count: today.counts.gaveUp, counts: "gave up" },
    review: { count: today.counts.waiting, counts: "waiting" },
  };
  return (
    <div
      data-ground="night"
      // The rail beside the content from `wide`, above it below: at 320px
      // a rail kept beside the column made the whole Desk scroll sideways
      // (plan 161, step 6; owner 2026-11-03).
      className="flex min-h-dvh flex-col bg-ground font-sans text-body text-ink wide:flex-row"
    >
      <nav
        aria-label="Desk"
        className="flex flex-col gap-8 border-b border-hairline p-6 wide:border-r wide:border-b-0"
      >
        <div className="flex flex-col gap-2">
          <span className="flex items-baseline gap-3 text-heading">
            <Wordmark />
            <Mono step="sm" className="text-hiviz-text">
              Desk
            </Mono>
          </span>
          <Mono step="xs" className="text-muted">
            Operator
          </Mono>
        </div>
        <ul className="flex flex-col gap-3">
          {DESK_PAGES.map((page) => (
            <RailEntry
              key={page}
              page={page}
              label={LABEL[page]}
              current={current}
              tally={tallies[page]}
            />
          ))}
        </ul>
      </nav>
      {/* `Page` for the column and the hydration stamp every screen
          carries (useHydrated), which the e2e specs wait on. */}
      <main className="min-w-0 flex-1">
        <Page>{children}</Page>
      </main>
    </div>
  );
}
