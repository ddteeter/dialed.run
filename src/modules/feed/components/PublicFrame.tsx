import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import { verdictLabel, type VerdictValue } from "../../../lib/contracts";
import { Mono, Page, Wordmark, verdictHue } from "../../../ui";

/**
 * What the open web's pages share (round 41 #86c, #86d, #86f): `/kit/<id>`
 * and `/@handle`, and their not-public twins, for anyone, signed in or
 * not.
 *
 * **One page for every viewer** (D-153). The server renders the signed-out
 * page, always, so the edge can keep it; only the top bar's right slot and
 * the invite block differ for a signed-in viewer, and both are filled in
 * the browser, after load, from a session check the route hands in.
 *
 * Every link that leaves these pages reloads the document: the app's root
 * reads the session on every other page (`lib/open-web`), and a page that
 * was rendered without one must not carry "nobody" into them.
 */

/**
The route's session check: the root's own `signedInQuery`.
*/
export type AskSignedIn = () => Promise<{ signedIn: boolean }>;

/**
 * Whether anyone is signed in, asked once the page is in the browser:
 * `false` on the server and until the answer comes, and if the question
 * fails, which leaves the signed-out page — the one that was cached.
 */
export function useSignedInAfterLoad(ask: AskSignedIn): {
  isSignedIn: boolean;
} {
  const [isSignedIn, setIsSignedIn] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const { signedIn } = await ask();
        setIsSignedIn(signedIn);
      } catch {
        // Nothing to say: the signed-out page is a whole page.
      }
    })();
  }, [ask]);
  return { isSignedIn };
}

/**
 * The marketing site (D-99), where the invite is asked for and the product
 * is explained. Not a route of this app, so a plain anchor.
 */
const MARKETING_ORIGIN = "https://dialed.run";

// The bar's one slot in pill form (round 42 #90): hairline for Log in,
// ink for the way into the app. Written out whole so each can be read as
// one class list (`targets-and-focus` reads the 44px target off it).
const LOG_IN_CLASS =
  "target inline-flex items-center rounded-pill border border-hairline px-5 text-small font-semibold text-ink no-underline";
const INTO_APP_CLASS =
  "target inline-flex items-center rounded-pill bg-ink px-5 text-small font-bold text-ground no-underline";
const FOOT_LINK_CLASS = "target text-muted underline underline-offset-4";

/**
 * Where "Open in the app" (or "Look in the app") goes: the app's own page
 * of the kit or of the runner, which runs its own check. Built from the
 * URL, never from what the page read.
 */
export type AppPage =
  { readonly entryId: string } | { readonly handle: string };

/**
 * The way into the app, signed in: the bar's one slot, in ink.
 */
function IntoApp({
  page,
  label,
}: Readonly<{ page: AppPage; label: string }>): JSX.Element {
  return "entryId" in page ? (
    <Link
      to="/feed/entry/$entryId"
      params={{ entryId: page.entryId }}
      reloadDocument
      data-part="bar-actions"
      className={INTO_APP_CLASS}
    >
      {label}
    </Link>
  ) : (
    <Link
      to="/feed/u/$handle"
      params={{ handle: page.handle }}
      reloadDocument
      data-part="bar-actions"
      className={INTO_APP_CLASS}
    >
      {label}
    </Link>
  );
}

/**
 * The frame's measure: the column alone, or — with a rail — DS1's two
 * columns at the desk, the page measure wide, with the bar and the foot
 * on the same measure so the wordmark lines up with the content. Each
 * class list written out whole, so the unknown-class lint can read it.
 */
const MEASURE = {
  column: {
    edge: "mx-auto flex min-h-11 w-full max-w-column items-center justify-between px-6",
    main: "mx-auto w-full max-w-column flex-1",
    foot: "m-0 mx-auto flex w-full max-w-column flex-wrap gap-x-4 px-6",
  },
  split: {
    edge: "mx-auto flex min-h-11 w-full max-w-column items-center justify-between px-6 desk:max-w-page",
    main: "mx-auto w-full max-w-column flex-1 desk:grid desk:max-w-page desk:grid-cols-[minmax(0,var(--container-column))_minmax(0,1fr)] desk:items-start desk:gap-x-6",
    foot: "m-0 mx-auto flex w-full max-w-column flex-wrap gap-x-4 px-6 desk:max-w-page",
  },
} as const;

/**
 * The public pages' top bar, on every width (round 42 #90): the bracketed
 * wordmark home, and one slot in pill form — a hairline Log in signed
 * out, an ink way into the app signed in, never both: a stranger with no
 * account gets nothing from "Open in the app".
 */
function PublicBar({
  intoApp,
  isSignedIn,
  edge,
}: Readonly<{ intoApp: IntoAppProps; isSignedIn: boolean; edge: string }>) {
  return (
    <div
      data-part="top-bar"
      className="border-b border-hairline bg-ground py-3 text-ink"
    >
      <div className={edge}>
        <Link
          to="/"
          reloadDocument
          aria-label="dialed.run home"
          className="target flex items-center no-underline"
        >
          <Wordmark className="text-title" />
        </Link>
        {isSignedIn ? (
          <IntoApp page={intoApp.page} label={intoApp.label} />
        ) : (
          <Link
            to="/auth/login"
            reloadDocument
            data-part="bar-actions"
            className={LOG_IN_CLASS}
          >
            Log in
          </Link>
        )}
      </div>
    </div>
  );
}

interface IntoAppProps {
  readonly page: AppPage;
  readonly label: string;
}

/**
 * A public page's own address and what its foot's Report link says, from
 * the page it is: `/kit/<id>` a kit, `/@<handle>` a profile.
 */
function reportOf(
  page: AppPage,
  origin: string,
): { label: string; location: string } {
  return "entryId" in page
    ? { label: "Report this kit", location: `${origin}/kit/${page.entryId}` }
    : { label: "Report this profile", location: `${origin}/@${page.handle}` };
}

/**
 * The page's one heading, and what sits with it: a kicker above (#86f's
 * 404) and something beside (#86c's day). One `<h1>`, in the frame, for
 * every page: a route renders one page or the other.
 */
interface FrameHeading {
  readonly text: ReactNode;
  readonly className: string;
  readonly kicker?: ReactNode;
  readonly beside?: ReactNode;
}

/**
 * What a page shows once it knows whether anyone is signed in: the frame
 * asks (`askSignedIn`) and hands the answer to whatever is drawn for it.
 */
type ForViewer = (isSignedIn: boolean) => ReactNode;

interface PublicFrameProps {
  /**
  The kit or the runner the page is at, from its URL.
  */
  readonly page: AppPage;
  /**
   * Where a public page lives, which makes it one: the bar offers "Open in
   * the app" and the foot a Report link with the page's own address,
   * handed to `/takedown` prefilled. Absent on a not-public page, whose bar
   * offers "Look in the app" and whose foot has nothing to report.
   */
  readonly origin?: string;
  readonly askSignedIn: AskSignedIn;
  readonly heading: FrameHeading;
  /**
   * Beside the column at the desk (DS1's rail), under it on the phone.
   * Absent, the page is the column alone, with no gap where it would be.
   */
  readonly rail?: ReactNode;
  /**
  What closes the page, after the rail on the phone, under the column at the desk.
  */
  readonly closing?: ForViewer;
  readonly children: ForViewer;
}

/**
 * The frame every public page wears: the bar, the column under its
 * heading (a `Page`, which stamps hydration), the rail and closing when
 * there are any, and the foot.
 */
export function PublicFrame(props: PublicFrameProps): JSX.Element {
  const { page, origin, askSignedIn, heading, rail, children } = props;
  const report = origin === undefined ? undefined : reportOf(page, origin);
  const intoApp = {
    page,
    label: origin === undefined ? "Look in the app" : "Open in the app",
  };
  const { isSignedIn } = useSignedInAfterLoad(askSignedIn);
  const closing = props.closing?.(isSignedIn);
  const measure = rail === undefined ? MEASURE.column : MEASURE.split;
  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <PublicBar
        intoApp={intoApp}
        isSignedIn={isSignedIn}
        edge={measure.edge}
      />
      <main className={measure.main}>
        <Page width="column">
          <header className="flex flex-col gap-3">
            {heading.kicker}
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h1 className={heading.className}>{heading.text}</h1>
              {heading.beside}
            </div>
          </header>
          {children(isSignedIn)}
        </Page>
        {rail === undefined ? undefined : (
          <div
            data-part="rail"
            className="flex flex-col gap-6 px-6 pb-8 desk:row-span-2 desk:py-8"
          >
            {rail}
          </div>
        )}
        {closing === undefined ? undefined : (
          <div className="px-6 pb-8 desk:col-start-1">{closing}</div>
        )}
      </main>
      <footer
        data-part="public-foot"
        className="border-t border-hairline py-4 text-small"
      >
        <p className={measure.foot}>
          {report === undefined ? undefined : (
            <Link
              to="/takedown"
              search={{ location: report.location }}
              reloadDocument
              className={FOOT_LINK_CLASS}
            >
              {report.label}
            </Link>
          )}
          <Link to="/privacy" reloadDocument className={FOOT_LINK_CLASS}>
            Privacy
          </Link>
          <Link to="/terms" reloadDocument className={FOOT_LINK_CLASS}>
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}

/**
 * What a public page of a runner or of their kit is handed by its route:
 * the page's own `origin` (for the Report link) and the route's session
 * check, with the page's own data beside them.
 */
export type OpenWebPageProps<Data extends object> = Readonly<
  Data & { origin: string; askSignedIn: AskSignedIn }
>;

/**
 * The frame for a page at a runner's own address: the heading is always
 * `@handle`, in the page's `headingClassName`, with `beside` after it.
 */
export function RunnerFrame({
  handle,
  headingClassName,
  beside,
  ...frame
}: Omit<PublicFrameProps, "heading"> &
  Readonly<{
    handle: string;
    headingClassName: string;
    beside?: ReactNode;
  }>): JSX.Element {
  return (
    <PublicFrame
      {...frame}
      heading={{ text: `@${handle}`, className: headingClassName, beside }}
    />
  );
}

/**
 * A titled list of named pieces — THE KIT · N on `/k`, IN USE · N and the
 * rest on `/@handle` — or nothing when there are none: the title and the
 * count in MONO.xs, one `<li>` a piece in `itemClassName`, drawn by `row`.
 * `level` is the heading's place in its page. Two pieces can share a name;
 * their place in the list cannot, so the key is both.
 */
export function PieceSection<Piece extends { readonly name: string }>({
  title,
  level,
  pieces,
  itemClassName,
  row,
}: Readonly<{
  title: string;
  level: 2 | 3;
  pieces: readonly Piece[];
  itemClassName: string;
  row: (piece: Piece) => ReactNode;
}>): JSX.Element | undefined {
  if (pieces.length === 0) return;
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="flex flex-col gap-2">
      <Heading className="m-0">
        <Mono step="xs" className="text-muted">
          {`${title} · ${String(pieces.length)}`}
        </Mono>
      </Heading>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {pieces.map((piece, index) => (
          <li key={`${String(index)}:${piece.name}`} className={itemClassName}>
            {row(piece)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A verdict as a chip in its T2 hue, or nothing for a kit with none.
 */
export function VerdictChip({
  verdict,
}: Readonly<{ verdict: VerdictValue | undefined }>) {
  if (verdict === undefined) return;
  return (
    <span
      data-part="verdict-chip"
      className={`rounded-pill border px-2 py-1 ${verdictHue(verdict)}`}
    >
      <Mono step="xs">{verdictLabel(verdict)}</Mono>
    </span>
  );
}

/**
 * The pitch (round 41 #86c), for the signed out only: the default card's
 * line, what the app does, and the two ways in. Sign-up is by invite, so
 * the primary asks for one on the marketing site; a code goes to `/join`.
 */
export function Invite() {
  return (
    <section
      data-part="invite"
      className="flex flex-col items-start gap-3 border-t border-hairline pt-6"
    >
      <h2 className="m-0 font-display text-title uppercase">
        Wear what worked.
      </h2>
      <p className="m-0 text-body text-quiet">
        dialed.run keeps what you wore on each run and how it felt, then tells
        you what to wear when that weather comes round again.
      </p>
      <a href={`${MARKETING_ORIGIN}/invite`} className={INTO_APP_CLASS}>
        Request an invite
      </a>
      <Link to="/join" reloadDocument className={FOOT_LINK_CLASS}>
        Have a code? Join
      </Link>
    </section>
  );
}

/**
 * Any public path's not-public page (round 41 #86f): the same page
 * whatever the reason, built from the URL and nothing else, saying what
 * pages at this path show and never what this one was. `/kit/<id>` names
 * the kit's id and `/@handle` its handle, which is never echoed: the page
 * only uses it, in the browser, for "Look in the app" — the bar's slot
 * signed in, to the app's own page, which runs its own check.
 */
export function NotPublicPage({
  page,
  askSignedIn,
}: Readonly<{ page: AppPage; askSignedIn: AskSignedIn }>): JSX.Element {
  const line =
    "entryId" in page
      ? "A kit shows here only while the runner who logged it keeps it public."
      : "A profile shows here only when its runner makes it public.";
  return (
    <PublicFrame
      page={page}
      askSignedIn={askSignedIn}
      heading={{
        text: "Nothing to see at this link",
        className: "m-0 font-display text-display uppercase",
        kicker: (
          <Mono step="xs" className="text-muted">
            404
          </Mono>
        ),
      }}
    >
      {() => (
        <section
          data-part="not-public"
          className="flex flex-col items-start gap-3"
        >
          <p className="m-0 text-body">{line}</p>
          <a href={MARKETING_ORIGIN} className={FOOT_LINK_CLASS}>
            What is dialed.run?
          </a>
        </section>
      )}
    </PublicFrame>
  );
}
