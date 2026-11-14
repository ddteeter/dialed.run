import { useSyncExternalStore } from "react";
import type { JSX, ReactNode } from "react";

import { Sheet } from "./Sheet";

/**
 * From `BREAKPOINT.desk` up: `--breakpoint-desk` in `src/styles.css`,
 * which a test pins this to.
 */
export const DESK_MEDIA_QUERY = "(min-width: 1040px)";

/**
 * The desk query, where there is one to ask. `typeof`, not `?.`, as
 * `shouldReduceMotion` explains: the DOM types call `matchMedia` always
 * present, and the server disagrees.
 */
function deskQuery(): MediaQueryList | undefined {
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia(DESK_MEDIA_QUERY)
    : undefined;
}

function onDeskChange(changed: () => void): () => void {
  const query = deskQuery();
  query?.addEventListener("change", changed);
  return () => {
    query?.removeEventListener("change", changed);
  };
}

/**
 * Whether the window is desk-wide now. With no query to ask, the server's
 * answer: desk, where the pane sits in the page.
 */
function isDeskNow(): boolean {
  return deskQuery()?.matches ?? true;
}

/**
 * The server renders the desk layout, and the first client render agrees
 * with it before the window's own answer takes over, so hydration never
 * meets a drawer the server did not send.
 */
function useIsDesk(): boolean {
  return useSyncExternalStore(onDeskChange, isDeskNow, () => true);
}

/**
 * A Desk table and its detail pane (Round 54 · 168.3, R55·203): from
 * `desk`, the table and a sticky pane beside it on a 2fr/1fr track (the
 * ruling's 1280 and 320, collapsed to the scale), the pane holding what
 * the operator picked, or `idle` while nothing is. `items-start` keeps a
 * tall pane from stretching the table's rows (P3-08).
 *
 * Below `desk` (R55·202) the picked thing opens as the desk drawer
 * (164.1) over the table instead: a non-modal `Sheet`, so the table
 * stays live and its picked row stays marked. Its ✕ and Escape unpick.
 * R56·243: for Runners and Codes; Review opens its rows in place.
 *
 * In `ui/` because the Desk's tables live in two modules (safety's
 * Runners, account's Codes) and neither may reach into the other.
 */
export function DeskDetail({
  picked,
  idle,
  onUnpick,
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
  /**
  The drawer was closed: nothing is picked any more.
  */
  onUnpick: () => void;
  children: ReactNode;
}>): JSX.Element {
  const isDesk = useIsDesk();
  return (
    <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {children}
      <Picked picked={picked} idle={idle} isDesk={isDesk} onUnpick={onUnpick} />
    </div>
  );
}

function Picked({
  picked,
  idle,
  isDesk,
  onUnpick,
}: Readonly<{
  picked: Readonly<{ name: string; detail: ReactNode }> | undefined;
  idle: ReactNode;
  isDesk: boolean;
  onUnpick: () => void;
}>): JSX.Element {
  if (picked === undefined) return <>{idle}</>;
  if (!isDesk) {
    return (
      <Sheet open isModal={false} label={picked.name} onClose={onUnpick}>
        {picked.detail}
      </Sheet>
    );
  }
  return (
    <aside
      aria-label={picked.name}
      data-part="desk-pane"
      className={PANE_CLASS}
    >
      {picked.detail}
    </aside>
  );
}

/**
The pane's frame: a --panel card, sticky beside the table from `desk`.
*/
const PANE_CLASS =
  "flex flex-col gap-4 rounded-card border border-hairline bg-panel p-5 desk:sticky desk:top-6";
