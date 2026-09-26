import {
  Link,
  useNavigate,
  useRouterState,
  type LinkProps,
} from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { PendingLabel } from "./form";
import { Icon } from "./icons";
import { LAUNCHER, TABS, bar, tabToLight, useSlowRoute } from "./tabs";
import { Wordmark } from "./Wordmark";

/**
 * DS1 — the one top bar, from `BREAKPOINT.wide` up.
 *
 * *"The tab bar becomes a top bar at 720. Same four destinations, same
 * order, as four text links."* **Not a sidebar**, and the contract is
 * emphatic about why: *"the left rail is the Desk's chrome and is what
 * marks a screen as operator-only. The product never grows one."*
 *
 * X and C were each drawn with a slightly different bar; DS1 supersedes
 * both, so this is one bar and not a reconciliation of three.
 *
 * **It is the product's first `[data-ground="ink"]` block.** T2 rule 04 —
 * *"ink bar on paper, paper bar on ink"* — and two things fall out of it
 * rather than being spelled: the focus ring is `var(--ink)` and so inverts
 * with the block (`ui/a11y.css`), and `--cold-text` resolves to
 * `--course-pink` inside it and to #C21A6B outside, which is exactly round
 * 15's rule for the underline (*"--action on ink, --cold-text on paper"*)
 * written once.
 *
 * The bell is `Layout`'s own node in a second seat, and the list it opens
 * is still the `/notifications` route — which at width *is* DS3's centred
 * panel. So D-87's trap (an unread row inside an inverted block, where
 * `--unread` stays the light column's pale yellow) never arises here: no
 * notification row is ever a descendant of this bar.
 */

/**
 * Full bar height with the rule at its foot, which is what makes the
 * active underline sit on the bar's own bottom edge rather than under the
 * word. The resting border is transparent rather than absent so a tab does
 * not move 2px when it becomes the current one.
 *
 * `target` for the 44 hit area; the bar's own height is `--bar-height`,
 * which is that target plus SPACE[2] either side. Nothing pins DS1a's
 * 60px — the sum happens to be 60, and `ui/Sheet` reads the same variable
 * to start the panel SPACE[12] below the bar rather than measuring it.
 */
const ACTIVE_LINK_CLASS =
  "tab-label target flex h-full items-center border-b-2 border-cold-text px-3 text-body font-bold text-ink no-underline";
const RESTING_LINK_CLASS =
  "tab-label target flex h-full items-center border-b-2 border-transparent px-3 text-body text-label no-underline";

/**
 * One of the four. A launcher is not one of them — it owns no path and the
 * underline never travels to it (round 12) — so it is filtered out by the
 * absence of a `label` mapping rather than by a flag read twice.
 */
function BarTab({
  to,
  label,
  active,
  waiting,
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  label: string;
  active: boolean;
  /**
   * X3 at desk: *"same on the bar-nav item"* — the lit link's label
   * breathes once its screen has taken 300ms. Only while waiting, so a
   * resting link's text is its label and nothing else.
   */
  waiting: boolean;
}>): JSX.Element {
  return (
    <li className="flex">
      <Link to={to} className={active ? ACTIVE_LINK_CLASS : RESTING_LINK_CLASS}>
        {waiting ? (
          <PendingLabel label={label} pendingLabel={label} pending />
        ) : (
          label
        )}
      </Link>
    </li>
  );
}

/**
 * The pink pill, on every screen.
 *
 * *"The phone's floating action sits in the tab bar; at width it's the
 * pink pill in the top bar."* Same control as `TabBar`'s launcher and the
 * same role — a `<button aria-haspopup="dialog">`, never a link, because
 * *"a launcher cannot be where you are"* — with the word the wider seat
 * has room for (round 15). No `aria-label`: the visible text is the name,
 * which is the whole reason the two seats are two elements.
 *
 * `text-accent-ink`, not `text-ink`: inside this block `--ink` is chalk,
 * and T1's note on `--action` is *"text on it is always ink"* meaning the
 * fixed #0B0B0E. That is the one thing an accent inside an inverted block
 * cannot say with a ground-relative role.
 */
function BarLauncher({
  to,
  label,
}: Readonly<{ to: NonNullable<LinkProps["to"]>; label: string }>): JSX.Element {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="target inline-flex items-center justify-center rounded-pill bg-action px-4 text-body font-bold text-accent-ink"
      onClick={() => {
        void navigate({ to });
      }}
    >
      {label}
    </button>
  );
}

/**
 * What the launcher says here. The phone bar's `+ Add` is a glyph-sized
 * seat; this one has room for the verb, and design called the pair
 * deliberate rather than tolerated (round 15).
 */
const LAUNCH_LABEL = "Log a run";

export function TopBar({ bell }: Readonly<{ bell?: ReactNode }>): JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // Read, never written. `TabBar` is mounted at every width — `wide:hidden`
  // is CSS, not a mount — so its effect is the one writer, and two bars
  // reading one memory is what stops the hidden one remembering a
  // different tab than the visible one across a resize.
  const active = tabToLight(pathname, bar.lastOnTab);
  const { isSlow } = useSlowRoute();

  return (
    <div
      data-ground="ink"
      data-slot="top-bar"
      className="hidden bg-ground px-6 text-ink wide:block"
    >
      <div className="mx-auto flex h-[var(--bar-height)] w-full max-w-page items-stretch gap-5 desk:gap-8">
        {/* The one place the logo appears in the product: "the phone has
            no wordmark on-screen". It links to Feed, which is the first
            tab, so it is a shortcut rather than a sixth destination. */}
        <Link
          to="/feed"
          aria-label="dialed.run home"
          className="target flex items-center no-underline"
        >
          <Wordmark className="text-title" />
        </Link>

        <nav aria-label="Main" className="flex">
          <ul className="m-0 flex list-none items-stretch gap-1 p-0">
            {TABS.map((tab, index) =>
              "launcher" in tab ? undefined : (
                <BarTab
                  key={tab.to}
                  to={tab.to}
                  label={tab.label}
                  // The index into `TABS`, not into the four that survive
                  // the filter: `tabToLight` answers in seats, and the
                  // launcher holds one.
                  active={index === active}
                  waiting={index === active && isSlow}
                />
              ),
            )}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Round 15 withdrew DS1a's 240px field: "a field is an input
              surface with states nobody drew". The glyph opens the search
              screen the Following empty state already links to, in the
              panel. */}
          <Link
            to="/feed/search"
            aria-label="Search runners"
            className="target inline-flex items-center justify-center no-underline"
          >
            <Icon name="search" size={20} />
          </Link>
          {bell}
          <BarLauncher to={LAUNCHER.to} label={LAUNCH_LABEL} />
        </div>
      </div>
    </div>
  );
}

/**
 * The one thing a landing bar may offer (round 21, item 23).
 *
 * - `log-in` — signed out on `/`: *"'Log in' is secondary (hairline)
 *   because the hero owns the primary ask"*.
 * - `closet` — signed in on `/`: *"the one action is ink-filled — it's the
 *   only thing a returning runner came to do"*.
 * - `none` — the auth pages (round 22, Auth §2): *"'Log in' on the log-in
 *   page would point at itself"*, and the form's cross-link does the job.
 *
 * Never pink: *"--action belongs to the product's own verbs"*.
 */
export type LandingAction = "none" | "log-in" | "closet";

const LANDING_ACTION_CLASS =
  "target inline-flex items-center rounded-pill px-5 text-small no-underline";

function LandingActionLink({
  action,
}: Readonly<{ action: LandingAction }>): JSX.Element | undefined {
  if (action === "log-in") {
    return (
      <Link
        to="/auth/login"
        data-part="bar-actions"
        className={`${LANDING_ACTION_CLASS} border border-hairline font-semibold text-ink`}
      >
        Log in
      </Link>
    );
  }
  if (action === "closet") {
    return (
      <Link
        to="/closet"
        data-part="bar-actions"
        className={`${LANDING_ACTION_CLASS} bg-ink font-bold text-ground`}
      >
        Your closet
      </Link>
    );
  }
  return undefined;
}

/**
 * The landing bar: the signed-out pages' only chrome, from 720 up.
 *
 * Round 21 drew it for `/` and round 22 gave it to the auth pages: paper,
 * a hairline foot, the plain wordmark linking to `/`, and at most one
 * action. **Not the product bar** — no nav, no search, no bell, no "Log a
 * run" — because every one of those is a signed-in place, and a signed-out
 * page never shows them (Auth §2, "The tab bar, signed out: Never").
 *
 * **Below 720 there is no bar at all**, so it is `hidden wide:block`; the
 * page's own wordmark does the job there. The row keeps a target's height
 * whether or not it carries an action, so `/` and `/auth/login` share a
 * baseline (Au2 1040's note).
 */
export function LandingBar({
  action,
}: Readonly<{ action: LandingAction }>): JSX.Element {
  return (
    <div
      data-slot="landing-bar"
      data-part="top-bar"
      className="hidden border-b border-hairline bg-ground px-6 py-4 text-ink wide:block"
    >
      <div className="mx-auto flex min-h-11 w-full max-w-page items-center justify-between">
        <Link
          to="/"
          aria-label="dialed.run home"
          data-part="wordmark"
          className="target flex items-center no-underline"
        >
          <Wordmark brackets={false} className="text-title" />
        </Link>
        <LandingActionLink action={action} />
      </div>
    </div>
  );
}
