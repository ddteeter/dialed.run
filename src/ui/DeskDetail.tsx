import type { JSX, ReactNode } from "react";

/**
 * A Desk table and its detail pane (Round 54 · 168.3, R55·203): from
 * `desk`, the table and a sticky pane beside it on a 2fr/1fr track (the
 * ruling's 1280 and 320, collapsed to the scale), the pane holding what
 * the operator picked, or `idle` while nothing is. `items-start` keeps a
 * tall pane from stretching the table's rows (P3-08).
 *
 * Below `desk` the pane follows the table. R55·202 makes that the desk
 * drawer over the table; it is built here, in one place, for every Desk
 * table at once.
 *
 * In `ui/` because the Desk's tables live in two modules (safety's
 * Runners, account's Codes) and neither may reach into the other.
 */
export function DeskDetail({
  picked,
  idle,
  children,
}: Readonly<{
  /**
   * What the operator picked: its detail, and the pane's accessible name
   * for it (whose or what it is). Undefined while nothing is.
   */
  picked: Readonly<{ name: string; detail: ReactNode }> | undefined;
  /**
  The pane's line while nothing is picked.
  */
  idle?: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {children}
      {picked === undefined ? (
        idle
      ) : (
        <aside
          aria-label={picked.name}
          data-part="desk-pane"
          className={PANE_CLASS}
        >
          {picked.detail}
        </aside>
      )}
    </div>
  );
}

/**
The pane's frame: a --panel card, sticky beside the table from `desk`.
*/
const PANE_CLASS =
  "flex flex-col gap-4 rounded-card border border-hairline bg-panel p-5 desk:sticky desk:top-6";
