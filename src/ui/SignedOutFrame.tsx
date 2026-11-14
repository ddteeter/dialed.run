import { Link, useRouterState } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { useHydrated } from "./use-hydrated";
import { Wordmark } from "./Wordmark";

/**
 * The one signed-out frame (Round 55 · 176): landing, auth, request
 * access, takedown, legal, /open-source, the public profile and kit, and
 * the signed-out 404 all wear it.
 *
 * - **The bar**, at every width: 56 on the phone and 64 from 720 up, on
 *   paper with a hairline foot, its content edge on MEASURE.page. The
 *   pink-bracketed `[dialed.run]` at TYPE.title links home. On the right,
 *   Log in as a text link, and from 720 up Request access as the 44 pink
 *   pill. **A page that is one of those two drops its own** — read from
 *   the path, so no page has to say which it is. A signed-in runner on a
 *   public page sees the page's own way into the app (`intoApp`, the ink
 *   pill) in their place.
 * - **The footer**: the five links, in round 27 #12's order then design
 *   136's removal request.
 *
 * Never the tab bar and never the product bar: every tab is a signed-in
 * place (round 22, Auth §2).
 *
 * It stamps hydration, as `Layout` does, so a page that wears it directly
 * (the landing page, the public pages) needs nothing else for the e2e
 * suite's wait.
 *
 * `reloadDocument` is the public pages' (`feed`'s `PublicFrame`): a page
 * the edge cached for nobody must not carry "nobody" into the app.
 */
export function SignedOutFrame({
  intoApp,
  reloadDocument = false,
  children,
}: Readonly<{
  /**
  A signed-in viewer's way into the app, in place of Log in and Request access.
  */
  intoApp?: ReactNode;
  reloadDocument?: boolean | undefined;
  children: ReactNode;
}>): JSX.Element {
  useHydrated();

  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <header
        data-slot="landing-bar"
        data-part="top-bar"
        className="border-b border-hairline bg-ground px-5 text-ink wide:px-6"
      >
        <div className="mx-auto flex h-14 w-full max-w-page items-center justify-between gap-4 wide:h-16">
          <Link
            to="/"
            reloadDocument={reloadDocument}
            aria-label="dialed.run home"
            data-part="wordmark"
            className="target flex items-center no-underline"
          >
            <Wordmark className="text-title" />
          </Link>
          {intoApp ?? <BarAsks reloadDocument={reloadDocument} />}
        </div>
      </header>
      {children}
      <SignedOutFooter reloadDocument={reloadDocument} />
    </div>
  );
}

/**
 * Log in as text; the pink pill only from 720 up (below it, the page
 * carries the ask itself — the landing hero, the 404's cross-link).
 */
const LOG_IN_CLASS =
  "target inline-flex items-center text-body font-bold text-ink no-underline";
const REQUEST_ACCESS_CLASS =
  "target hidden items-center rounded-pill bg-action px-4 text-body font-bold text-accent-ink no-underline wide:inline-flex";

const LOG_IN_PATH = "/auth/login";
const REQUEST_ACCESS_PATH = "/account/request-access";

function BarAsks({
  reloadDocument,
}: Readonly<{ reloadDocument: boolean }>): JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <div data-part="bar-actions" className="flex items-center gap-6">
      {pathname === LOG_IN_PATH ? undefined : (
        <Link
          to={LOG_IN_PATH}
          reloadDocument={reloadDocument}
          className={LOG_IN_CLASS}
        >
          Log in
        </Link>
      )}
      {pathname === REQUEST_ACCESS_PATH ? undefined : (
        <Link
          to={REQUEST_ACCESS_PATH}
          reloadDocument={reloadDocument}
          className={REQUEST_ACCESS_CLASS}
        >
          Request access
        </Link>
      )}
    </div>
  );
}

/**
 * The footer's links (task 126, ACC-13; D-52; round 27 #12: "Footer order
 * everywhere: Privacy · Terms · Copyright"; round 29 #9's Open source;
 * design 136's removal request, which the TAKE IT DOWN Act asks to be
 * clear and conspicuous, so it is on every page). Each links even while
 * its page answers X1 (D-81). TYPE.small in `--quiet`, underlined.
 *
 * The gaps are the links' own padding, not `gap-x` (#632 A-03): padded,
 * every link clears 44 and every gap is the same 16px. The row's negative
 * margin keeps the first word on the content edge.
 */
const FOOTER_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/copyright", label: "Copyright" },
  { to: "/open-source", label: "Open source" },
  { to: "/takedown", label: "Report an intimate image" },
] as const;

const FOOTER_LINK_CLASS =
  "target inline-flex items-center px-2 text-quiet underline underline-offset-4";

function SignedOutFooter({
  reloadDocument,
}: Readonly<{ reloadDocument: boolean }>): JSX.Element {
  return (
    <footer
      data-part="legal-footer"
      className="border-t border-hairline px-5 py-4 text-small wide:px-6"
    >
      <p className="m-0 mx-auto w-full max-w-page">
        <span className="-mx-2 flex flex-wrap">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              reloadDocument={reloadDocument}
              className={FOOTER_LINK_CLASS}
            >
              {link.label}
            </Link>
          ))}
        </span>
      </p>
    </footer>
  );
}
