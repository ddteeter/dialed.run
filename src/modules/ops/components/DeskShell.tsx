import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { timeOfDay } from "../../../lib/dates";
import { Mono, Page, Wordmark } from "../../../ui";
import type { DeskToday } from "../desk";
import { DeskSignOut } from "./DeskSignOut";

/**
 * The Desk's shell (Operator Screens D0; decision D-35). Always dark
 * whatever the operator's theme — it is a tool, not the product — with
 * hi-viz as its only accent, a left rail the runner app never has, and no
 * link to or from the runner app.
 *
 * `data-ground="night"` is T1's dark column in both themes (design 185):
 * it redefines every ground-relative role, so the tokens below mean
 * "against ink" without a second palette, and it reads nothing from the
 * page. Not `ink`, the ink block, which becomes `--panel` with a hairline
 * on a dark page (R50·143.1, rule 04's fallback): T3 says the Desk
 * "doesn't read the runner's theme", and R50·143.1 that "the Desk stays
 * ink".
 */

/**
 * Every destination the rail names, in Round 55 · 194's order: the board's
 * seven, with Codes its own page beside Access (Requests). Gave up is not
 * one: it is a section of Today, and Today's rail count is its count.
 */
const DESK_PAGES = [
  "today",
  "review",
  "corrections",
  "access",
  "duplicates",
  "codes",
  "runners",
] as const;

export type DeskPage = (typeof DESK_PAGES)[number];

/**
 * Round 54 · 168.3: Runners, Codes and Review are tables, and fill the
 * width beside the rail up to MEASURE.page. The rest keep the 620
 * document column.
 */
const WIDTH: Readonly<Record<DeskPage, "table" | "column">> = {
  today: "column",
  review: "table",
  corrections: "column",
  access: "column",
  duplicates: "column",
  codes: "table",
  runners: "table",
};

const LABEL: Readonly<Record<DeskPage, string>> = {
  today: "Today",
  review: "Review",
  corrections: "Corrections",
  access: "Access",
  duplicates: "Duplicates",
  codes: "Codes",
  runners: "Runners",
};

/**
 * Where each destination lives. Every one is built, so the rail has no
 * placeholder entry and a new page cannot be named without a route to go
 * with it.
 */
const HREF: Readonly<
  Record<
    DeskPage,
    | "/desk"
    | "/desk/review"
    | "/desk/corrections"
    | "/desk/runners"
    | "/desk/access"
    | "/desk/codes"
    | "/desk/duplicates"
  >
> = {
  today: "/desk",
  review: "/desk/review",
  corrections: "/desk/corrections",
  access: "/desk/access",
  duplicates: "/desk/duplicates",
  codes: "/desk/codes",
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

/**
 * R55·194/195: the current entry is marked by its edge, not its colour, so
 * hi-viz text stays for the counts that need a person. At width that edge
 * is a 2px hi-viz bar on the left with a --panel fill and bold text; on a
 * phone, where the rail is one row, it is a 2px hi-viz underline.
 */
const RAIL_ENTRY =
  "flex min-h-control items-center gap-2 border-b-2 px-3 text-body text-ink no-underline wide:justify-between wide:gap-6 wide:border-b-0 wide:border-l-2 wide:pr-5 wide:pl-6";
const RAIL_CURRENT = "border-hi-viz font-bold wide:bg-panel";
const RAIL_OTHER = "border-transparent";

/**
 * The current entry, scrolled into view in the phone's sideways row (R55·
 * 195). `nearest` on both axes, so at width, where the rail is a column
 * already in view, nothing moves.
 */
function scrollIntoRow(link: HTMLAnchorElement | null): void {
  link?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function RailEntry({
  page,
  current,
  tally,
}: Readonly<{
  page: DeskPage;
  current: DeskPage;
  tally: RailTally | undefined;
}>) {
  const isActive = page === current;
  return (
    <li>
      <Link
        to={HREF[page]}
        ref={isActive ? scrollIntoRow : undefined}
        // Exact: by default Link marks a prefix match current, so Today
        // ("/desk") read as the current page on every Desk page. The
        // Link sets aria-current itself whenever it matches.
        activeOptions={{ exact: true }}
        aria-current={isActive ? "page" : undefined}
        className={`${RAIL_ENTRY} ${isActive ? RAIL_CURRENT : RAIL_OTHER}`}
      >
        <span>{LABEL[page]}</span>
        <RailCount tally={tally} />
      </Link>
    </li>
  );
}

/**
 * The rail's foot at width (R55·194), pinned there: whether screening is
 * holding (a breaker over its ceiling this hour, design 164) and when the
 * daily digest last ran, in UTC like the date on Today. The words for
 * neither-OK state are the owner's (2026-11-13, #635).
 */
function RailFooter({ today }: Readonly<{ today: DeskToday }>) {
  const isHolding = today.breakers.length > 0;
  const lastDigestAt = today.counts.lastDigestAt;
  return (
    <div
      data-part="rail-footer"
      className="hidden wide:flex wide:flex-col wide:gap-1 wide:px-6 wide:pt-6"
    >
      <Mono step="xs" className={isHolding ? "text-hiviz-text" : "text-muted"}>
        {isHolding ? "Screening · Holding" : "Screening · OK"}
      </Mono>
      <Mono step="xs" className="text-muted">
        {`Last digest · ${lastDigestAt === undefined ? "Not yet" : timeOfDay(lastDigestAt)}`}
      </Mono>
    </div>
  );
}

/**
 * The Desk's top bar (R55·194/195): `[dialed] DESK` at the left, and at the
 * right the operator's handle, their role and Sign out. On a phone the bar
 * is the 48 row and keeps only Sign out. The handle is in its own case:
 * a handle is never shouted (G-19).
 */
function DeskBar({ handle }: Readonly<{ handle: string | undefined }>) {
  return (
    <header
      data-part="desk-bar"
      className="flex min-h-control items-center justify-between gap-4 pr-3 pl-4 wide:min-h-[var(--bar-height)] wide:border-b wide:border-hairline wide:px-6"
    >
      <span className="flex items-baseline gap-2 text-heading wide:gap-3">
        <Wordmark isDeskMark />
        <Mono step="xs" className="text-hiviz-text">
          Desk
        </Mono>
      </span>
      <span className="flex items-center gap-2">
        <span
          data-part="operator"
          className="hidden font-mono text-mono-xs text-muted wide:inline"
        >
          {handle === undefined ? undefined : `@${handle} · `}
          <span className="uppercase">Operator ·</span>
        </span>
        <DeskSignOut />
      </span>
    </header>
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
    // Under Review, above Duplicates (R48·130), counting queue rows.
    corrections: { count: today.counts.corrections, counts: "waiting" },
  };
  return (
    <div
      data-ground="night"
      className="flex min-h-dvh flex-col bg-ground font-sans text-body text-ink"
    >
      <DeskBar handle={today.operatorHandle} />
      {/* The rail beside the content from `wide`; below it, one sticky row
          under the bar that scrolls sideways (R55·195), so a page's heading
          starts near the top instead of under six stacked rows (G-03). */}
      <div className="flex flex-1 flex-col wide:flex-row">
        <nav
          aria-label="Desk"
          className="sticky top-0 z-10 overflow-x-auto border-y border-hairline bg-ground px-2 wide:static wide:flex wide:flex-col wide:justify-between wide:overflow-visible wide:border-y-0 wide:border-r wide:px-0 wide:py-4"
        >
          <ul className="m-0 flex list-none gap-1 p-0 whitespace-nowrap wide:flex-col wide:gap-0">
            {DESK_PAGES.map((page) => (
              <RailEntry
                key={page}
                page={page}
                current={current}
                tally={tallies[page]}
              />
            ))}
          </ul>
          <RailFooter today={today} />
        </nav>
        {/* `Page` for the column and the hydration stamp every screen
            carries (useHydrated), which the e2e specs wait on. */}
        <main className="min-w-0 flex-1">
          <Page width={WIDTH[current]}>{children}</Page>
        </main>
      </div>
    </div>
  );
}
