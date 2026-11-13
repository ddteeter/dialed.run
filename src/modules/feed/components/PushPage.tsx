import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { Icon } from "../../../ui";

/**
 * A picker at the desk is a push into the 620 column, not a sheet (Round
 * 54 · 164.3): *"Back link, title, meta, search, one card of checkboxes,
 * then Done as the pink caps button at content width. The URL changes.
 * Rule: a list that can grow pushes."* A2b and A3b are both drawn in this
 * one frame, so the two pushes of one flow cannot come apart.
 */

/**
 * The screen's column, or the page pushed into it. The screen is then
 * hidden rather than gone: it is still the same page, so what the runner
 * has done on it — A2's picks and held photo, A3's unsaved answer — is
 * there when they come back.
 */
export function PushFrame({
  pushed,
  children,
}: Readonly<{
  pushed: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  return (
    <>
      {pushed}
      <div hidden={pushed !== undefined} className="flex flex-col gap-6">
        {children}
      </div>
    </>
  );
}

/**
 * The pushed page: its way back, then its body. `slot` names it for the
 * harness, as each screen's regions are named.
 */
export function PushPage({
  slot,
  back,
  children,
}: Readonly<{
  slot: string;
  back: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div data-slot={slot} className="flex flex-col gap-6">
      {back}
      {children}
    </div>
  );
}

/**
 * The way back from a push: the board's back link, named for the screen
 * it returns to (Round 54 · 164b). That screen is this page with nothing
 * pushed, so it drops the search and keeps everything else.
 */
export function PushBack({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <Link
      to="."
      search={{}}
      className="target inline-flex items-center gap-2 self-start text-body text-ink no-underline"
    >
      <Icon name="back" size={20} />
      {children}
    </Link>
  );
}

/**
The pushed page's title: the page's heading, at the title step.
*/
export const PUSH_TITLE_CLASS = "m-0 font-display text-title";

/**
 * The pushed page's heading. It is the screen's one h1 while the page is
 * pushed: the screen under it is `hidden`, and its own h1 with it, so the
 * two are never heard together (rule 04;
 * test/architecture/one-h1-per-route.test.ts reads this file's h1 as
 * standing in for the screen's, and the dom tests count what is exposed).
 */
export function PushTitle({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return <h1 className={PUSH_TITLE_CLASS}>{children}</h1>;
}

/**
 * Done, as the flow's forward action: the pink caps button at content
 * width (Round 54 · 167).
 */
export function PushDone({
  onDone,
}: Readonly<{ onDone: () => void }>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onDone}
      className="target grid min-h-13 cursor-pointer place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase text-accent-ink"
    >
      Done
    </button>
  );
}
