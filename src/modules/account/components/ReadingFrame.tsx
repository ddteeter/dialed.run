import type { ComponentType, JSX, ReactNode } from "react";

import { Layout, Mono, SignedOutLayout } from "../../../ui";
import type { BellState } from "../../notifications";

/**
 * The reading page's frame (task 126, ACC-13; round 26 #14, round 27 #5
 * and #12, round 28 #16; D-52), shared by the legal texts and
 * `/open-source` (round 29 #9: "The layout is the legal reading page").
 *
 * **Contract values, not the board's**: the 620 document measure
 * (`max-w-column`) and the `lead` step. At the desk the contents sit in a
 * sticky column to the left; on the phone they are a plain list under the
 * heading. Every H2 has an id and, below the desk, ends with "Back to
 * contents" (round 28 #16: no arrow, which is not a product glyph; at the
 * desk the column is in view, so the link is not drawn). No accordions;
 * inline links are underlined.
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
 * anyone else in the signed-out one.
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
    <SignedOutLayout action="log-in">{children}</SignedOutLayout>
  ) : (
    <Layout bell={<Bell {...bellState} />}>{children}</Layout>
  );
}

export function ReadingFrame({
  title,
  kicker,
  contents,
  children,
}: Readonly<{
  title: string;
  /**
  A mono line above the title (`/open-source`'s OPEN SOURCE).
  */
  kicker?: string | undefined;
  contents: readonly ContentsEntry[];
  children: ReactNode;
}>): JSX.Element {
  return (
    <main className="px-5 pt-8 pb-16 desk:grid desk:grid-cols-[auto_1fr] desk:gap-x-12">
      <header className="flex flex-col gap-2 desk:col-start-2 desk:row-start-1">
        {kicker === undefined ? undefined : (
          <Mono step="xs" className="text-muted">
            {kicker}
          </Mono>
        )}
        <h1 className="m-0 font-display text-display uppercase">{title}</h1>
      </header>
      <nav
        id="contents"
        aria-label="Contents"
        className="mt-6 desk:sticky desk:top-8 desk:col-start-1 desk:row-span-2 desk:row-start-1 desk:mt-0 desk:self-start"
      >
        <h2 className="m-0 text-muted">
          <Mono step="xs">Contents</Mono>
        </h2>
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-body">
          {contents.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2">
              <a
                href={`#${entry.id}`}
                className="target text-ink underline underline-offset-4"
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
    </main>
  );
}

/**
An H2 and what follows it, closed by "Back to contents" below the desk.
*/
export function ReadingSection({
  id,
  heading,
  children,
}: Readonly<{ id: string; heading: ReactNode; children: ReactNode }>) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 pt-4">
      <h2 id={id} className="m-0 text-heading font-semibold">
        {heading}
      </h2>
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
