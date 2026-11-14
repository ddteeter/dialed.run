import type { ComponentType, JSX, ReactNode } from "react";

import { Layout, Mono, SignedOutLayout } from "../../../ui";
import type { BellState } from "../../notifications";

/**
 * The reading page's frame (task 126, ACC-13; round 26 #14, round 27 #5
 * and #12, round 28 #16; D-52; Round 55 · 220–223), shared by the legal
 * texts and `/open-source` (round 29 #9: "The layout is the legal reading
 * page").
 *
 * **Contract values, not the board's**: the 620 document measure
 * (`max-w-column`) and the `lead` step. At the desk the contents sit in a
 * sticky rail of a fixed 240 to the left (R53·163); on the phone they are
 * a plain list under the heading. Every H2 has an id and, below the desk,
 * ends with "Back to contents" (round 28 #16: no arrow, which is not a
 * product glyph; at the desk the column is in view, so the link is not
 * drawn). No accordions; inline links are underlined.
 */

/**
One line of the contents: a section's id and its name, and a count if it has one.
*/
export interface ContentsEntry {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
}

/**
 * A signed-in reader reads in the signed-in shell, with the bell, and
 * anyone else in the signed-out one. The signed-in shell is the page's one
 * `<main>` (`Layout`); the signed-out one leaves it to the page, so here it
 * is the shell's, never the frame's: inside `Layout` a frame of its own
 * was a second `main` in the first.
 */
export function ReadingShell({
  bellState,
  bell,
  children,
}: Readonly<{
  /**
  The bell's counts for a signed-in reader; absent for a signed-out one.
  */
  bellState: BellState | undefined;
  /**
  The bell for the signed-in shell, given its counts (the route's to wire).
  */
  bell: ComponentType<BellState>;
  children: ReactNode;
}>): JSX.Element {
  const Bell = bell;
  return bellState === undefined ? (
    <SignedOutLayout>
      <main>{children}</main>
    </SignedOutLayout>
  ) : (
    <Layout bell={<Bell {...bellState} />}>{children}</Layout>
  );
}

export function ReadingFrame({
  title,
  kicker,
  notice,
  contents,
  children,
}: Readonly<{
  title: string;
  /**
  A mono line above the title (`/open-source`'s OPEN SOURCE).
  */
  kicker?: string | undefined;
  /**
  A block under the title and above the contents (R55·223's draft notice).
  */
  notice?: ReactNode;
  contents: readonly ContentsEntry[];
  children: ReactNode;
}>): JSX.Element {
  // `/open-source`'s contents count each group and are drawn as a tally
  // (round 29 #9, round 40 #82): plain rows, the counts in a right-hand
  // column. A legal text's are underlined links (R55·220's board).
  const isTally = contents.some((entry) => entry.count !== undefined);
  return (
    // A container, so a wide table can break out to the page measure's
    // right edge (`LegalPage`'s `WideTable`, R55·220). P4-02: the rail is
    // a fixed 240 (R53·163), so the text starts at one x on every page.
    <div className="@container px-5 pt-8 pb-16 desk:grid desk:max-w-page desk:grid-cols-[240px_minmax(0,1fr)] desk:gap-x-12">
      <header className="flex flex-col gap-2 desk:col-start-2 desk:row-start-1">
        {kicker === undefined ? undefined : (
          <Mono step="xs" className="text-muted">
            {kicker}
          </Mono>
        )}
        <h1 className="m-0 font-display text-display uppercase">{title}</h1>
        {notice}
      </header>
      <nav
        id="contents"
        aria-label="Contents"
        // P4-03: at the desk the rail scrolls itself rather than running
        // below the fold: the window, less its top and bottom 32.
        className="mt-6 desk:sticky desk:top-8 desk:col-start-1 desk:row-span-2 desk:row-start-1 desk:mt-0 desk:max-h-[calc(100dvh-var(--spacing)*16)] desk:self-start desk:overflow-y-auto"
      >
        <h2 className="m-0 text-muted">
          <Mono step="xs">Contents</Mono>
        </h2>
        <ol className="m-0 mt-2 flex list-none flex-col gap-3 p-0 text-body">
          {contents.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline justify-between gap-2"
            >
              <a
                href={`#${entry.id}`}
                className={isTally ? TALLY_LINK_CLASS : LINK_CLASS}
              >
                {entry.title}
              </a>
              {entry.count === undefined ? undefined : (
                <Mono step="md" className="text-muted">
                  {String(entry.count)}
                </Mono>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <article className="mt-8 flex max-w-column flex-col gap-4 text-lead desk:col-start-2">
        {children}
      </article>
    </div>
  );
}

/**
 * A-02, P4-03: a contents entry is a line target (`a11y.css`), not a 44
 * box, so a row is its line and a short label keeps its count close.
 */
const LINK_CLASS =
  "target-line inline-block text-ink underline underline-offset-4";
const TALLY_LINK_CLASS = "target-line inline-block text-ink no-underline";

/**
 * R55·222: a section of a long text opens on a hairline with 48 above it
 * (the article's 16 gap and this 32). `/open-source`'s groups are rows
 * that carry their own hairlines, so its sections are not ruled.
 */
const RULED_SECTION_CLASS =
  "mt-8 flex flex-col gap-4 border-t border-hairline pt-4";
const SECTION_CLASS = "flex flex-col gap-4 pt-4";

/**
 * An H2 and what follows it, closed by "Back to contents" below the desk.
 * The heading is TYPE.title in the display face (R55·222, A-01e), with an
 * `aside` (a group's count) at the end of its line (A-01a).
 */
export function ReadingSection({
  id,
  heading,
  aside,
  ruled = false,
  children,
}: Readonly<{
  id: string;
  heading: ReactNode;
  /**
  Drawn at the end of the heading's line.
  */
  aside?: ReactNode;
  /**
  A hairline above, with 48 above that (a legal text's sections).
  */
  ruled?: boolean;
  children: ReactNode;
}>) {
  return (
    <section
      aria-labelledby={id}
      className={ruled ? RULED_SECTION_CLASS : SECTION_CLASS}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="m-0 font-display text-title">
          {heading}
        </h2>
        {aside}
      </div>
      {children}
      <a
        href="#contents"
        className="target self-start text-small text-ink underline underline-offset-4 desk:hidden"
      >
        Back to contents
      </a>
    </section>
  );
}
