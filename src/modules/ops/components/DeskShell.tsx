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
 * `data-ground="ink"` is the brand's own inverted block (T2 rule 04): it
 * redefines every ground-relative role, so the tokens below mean "against
 * ink" without a second palette.
 */

/**
 * Every destination the rail names, in D0's order plus round 26's D7.
 */
const DESK_PAGES = [
  "today",
  "review",
  "duplicates",
  "gave-up",
  "runners",
  "access",
] as const;

export type DeskPage = (typeof DESK_PAGES)[number];

const LABEL: Readonly<Record<DeskPage, string>> = {
  today: "Today",
  review: "Review",
  duplicates: "Duplicates",
  "gave-up": "Gave up",
  runners: "Runners",
  access: "Access",
};

/**
 * Where each built destination lives. A page not in here is not built
 * yet, and its rail entry is text rather than a link (placeholder
 * protocol): Duplicates and Gave up are task 110's, Runners and its ban
 * panel 128's, Access 126's (D7). Each lane adds its line when its page
 * lands. Review is the queue task 106 built, at its own address until 128
 * moves it under `/desk`.
 */
const BUILT: Readonly<Partial<Record<DeskPage, "/desk" | "/safety/review">>> = {
  today: "/desk",
  review: "/safety/review",
};

/**
A count that needs a person is hi-viz; at zero it is not shown at all.
*/
function RailCount({ count }: Readonly<{ count: number | undefined }>) {
  if (count === undefined || count === 0) return;
  return (
    <Mono step="sm" className="text-hi-viz">
      {count}
    </Mono>
  );
}

function RailEntry({
  page,
  label,
  current,
  count,
}: Readonly<{
  page: DeskPage;
  label: string;
  current: DeskPage;
  count: number | undefined;
}>) {
  const isActive = page === current;
  const tone = isActive ? "text-hi-viz" : "text-ink";
  const content = (
    <>
      <span>{label}</span>
      <RailCount count={count} />
    </>
  );
  const to = BUILT[page];
  if (to === undefined) {
    return (
      <li className="flex items-baseline justify-between gap-6 text-muted">
        {content}
      </li>
    );
  }
  return (
    <li>
      <Link
        to={to}
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
  // Only a destination that needs a person carries a count.
  const counts: Partial<Record<DeskPage, number>> = {
    review: today.counts.waiting,
  };
  return (
    <div
      data-ground="ink"
      className="flex min-h-dvh bg-ground font-sans text-body text-ink"
    >
      <nav
        aria-label="Desk"
        className="flex flex-col gap-8 border-r border-hairline p-6"
      >
        <div className="flex flex-col gap-2">
          <span className="flex items-baseline gap-3 text-heading">
            <Wordmark />
            <Mono step="sm" className="text-hi-viz">
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
              count={counts[page]}
            />
          ))}
        </ul>
      </nav>
      {/* `Page` for the column and the hydration stamp every screen
          carries (useHydrated), which the e2e specs wait on. */}
      <main className="flex-1">
        <Page>{children}</Page>
      </main>
    </div>
  );
}
