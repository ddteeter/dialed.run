import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import { verdictLabel, type VerdictValue } from "../../../lib/contracts";
import {
  Mono,
  Page,
  WeatherAttribution,
  Wordmark,
  verdictHue,
} from "../../../ui";
import { ProductLink } from "../../../ui/ProductLink";
import type { PublicKit, PublicPiece } from "../public-kit-shape";

/**
 * The open web's kit (round 41 #86c) and its not-public twin (#86f):
 * `/k/<id>`, for anyone, signed in or not.
 *
 * **One page for every viewer** (D-152). The server renders the signed-out
 * page, always, so the edge can keep it; only the top bar's right slot and
 * the invite block differ for a signed-in viewer, and both are filled in
 * the browser, after load, from a session check the route hands in. No
 * Useful, follow or comment, signed in or not.
 *
 * Every link that leaves this page reloads the document: the app's root
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

// The landing bar's two pills, written out whole so each can be read as
// one class list (`targets-and-focus` reads the 44px target off it).
const LOG_IN_CLASS =
  "target inline-flex items-center rounded-pill border border-hairline px-5 text-small font-semibold text-ink no-underline";
const INTO_APP_CLASS =
  "target inline-flex items-center rounded-pill bg-ink px-5 text-small font-bold text-ground no-underline";
const FOOT_LINK_CLASS = "target text-muted underline underline-offset-4";

/**
 * The public pages' top bar, on every width: the wordmark home, and one
 * slot — Log in signed out, a way into the app signed in (`intoApp`, whose
 * words differ by page). The landing bar's two pills, since this is a
 * signed-out page with one action.
 */
function PublicBar({
  entryId,
  intoApp,
  isSignedIn,
}: Readonly<{ entryId: string; intoApp: string; isSignedIn: boolean }>) {
  return (
    <div
      data-part="top-bar"
      className="border-b border-hairline bg-ground py-3 text-ink"
    >
      <div className="mx-auto flex min-h-11 w-full max-w-column items-center justify-between px-6">
        <Link
          to="/"
          reloadDocument
          aria-label="dialed.run home"
          className="target flex items-center no-underline"
        >
          <Wordmark className="text-title" />
        </Link>
        {isSignedIn ? (
          <Link
            to="/feed/entry/$entryId"
            params={{ entryId }}
            reloadDocument
            data-part="bar-actions"
            className={INTO_APP_CLASS}
          >
            {intoApp}
          </Link>
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

/**
 * The page's one heading, and what sits with it: a kicker above (#86f's
 * 404) and something beside (#86c's day). One `<h1>`, in the frame, for
 * both pages: the route renders one or the other.
 */
interface FrameHeading {
  readonly text: ReactNode;
  readonly className: string;
  readonly kicker?: ReactNode;
  readonly beside?: ReactNode;
}

interface PublicFrameProps {
  readonly entryId: string;
  readonly intoApp: string;
  readonly isSignedIn: boolean;
  readonly heading: FrameHeading;
  readonly foot?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The frame both pages wear: the bar, the column under its heading (a
 * `Page`, which stamps hydration), and the foot.
 */
function PublicFrame(props: PublicFrameProps): JSX.Element {
  const { entryId, intoApp, isSignedIn, heading, foot, children } = props;
  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <PublicBar entryId={entryId} intoApp={intoApp} isSignedIn={isSignedIn} />
      <main className="mx-auto w-full max-w-column flex-1">
        <Page width="column">
          <header className="flex flex-col gap-3">
            {heading.kicker}
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h1 className={heading.className}>{heading.text}</h1>
              {heading.beside}
            </div>
          </header>
          {children}
        </Page>
      </main>
      <footer
        data-part="public-foot"
        className="border-t border-hairline py-4 text-small"
      >
        <p className="m-0 mx-auto flex w-full max-w-column flex-wrap gap-x-4 px-6">
          {foot}
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
 * `/k/<id>` for a public kit (round 41 #86c). Order: who and which day,
 * conditions and verdict, the four stats, the caption, the kit, the
 * credit, the pitch, the foot. No photo yet (D-151 waits on the public
 * bucket).
 *
 * `origin` is where the page lives, for the link Report this kit hands
 * `/takedown`: the route's, so the server's page and the browser's agree.
 */
export function PublicKitPage({
  kit,
  origin,
  askSignedIn,
}: Readonly<{
  kit: PublicKit;
  origin: string;
  askSignedIn: AskSignedIn;
}>): JSX.Element {
  const { isSignedIn } = useSignedInAfterLoad(askSignedIn);
  return (
    <PublicFrame
      entryId={kit.entryId}
      intoApp="Open in the app"
      isSignedIn={isSignedIn}
      heading={{
        text: `@${kit.handle}`,
        className: "m-0 text-body font-semibold",
        beside: (
          <Mono step="xs" className="text-muted">
            {kit.day}
          </Mono>
        ),
      }}
      foot={
        <Link
          to="/takedown"
          search={{ location: `${origin}/k/${kit.entryId}` }}
          reloadDocument
          className={FOOT_LINK_CLASS}
        >
          Report this kit
        </Link>
      }
    >
      <Conditions kit={kit} />
      <Stats kit={kit} />
      {kit.caption === undefined ? undefined : (
        <p data-part="caption" className="m-0 text-lead">
          {kit.caption}
        </p>
      )}
      <Pieces pieces={kit.pieces} />
      {kit.conditions?.isProviders === true ? (
        <WeatherAttribution />
      ) : undefined}
      {isSignedIn ? undefined : <Invite />}
    </PublicFrame>
  );
}

/**
 * Feels-like and sky in TYPE.display — the measured word teal, as teal
 * always means measured conditions — beside the verdict's chip in its T2
 * hue, captioned FEELS LIKE · SKY. A kit with no conditions shows the chip
 * alone; one with neither shows nothing.
 */
function Conditions({ kit }: Readonly<{ kit: PublicKit }>) {
  const { conditions, verdict } = kit;
  if (conditions === undefined && verdict === undefined) return;
  return (
    <div data-part="conditions" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {conditions === undefined ? undefined : (
          <span className="font-display text-display uppercase">
            {conditions.feelsLike}{" "}
            <span className="text-dialed-text">{conditions.sky}</span>
          </span>
        )}
        <VerdictChip verdict={verdict} />
      </div>
      {conditions === undefined ? undefined : (
        <Mono step="xs" className="text-muted">
          Feels like · Sky
        </Mono>
      )}
    </div>
  );
}

function VerdictChip({
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
 * The four stats as round 41 draws them: the number in MONO.lg, its word
 * under it in MONO.xs. Moving time is named for what it is: "moving" when
 * the file measured it, "time" when the run's own clock is all there is.
 */
function Stats({ kit }: Readonly<{ kit: PublicKit }>) {
  const stats = [
    kit.distance,
    {
      value: kit.time.value,
      unit: kit.time.isMoving ? "moving" : "time",
    },
    ...(kit.pace === undefined ? [] : [kit.pace]),
    ...(kit.gain === undefined
      ? []
      : [{ value: kit.gain.value, unit: `${kit.gain.unit} gain` }]),
  ];
  return (
    <dl data-part="stats" className="m-0 grid grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div key={stat.unit} className="flex flex-col-reverse gap-1">
          <dt>
            <Mono step="xs" className="text-muted">
              {stat.unit}
            </Mono>
          </dt>
          <dd className="m-0">
            <Mono step="lg">{stat.value}</Mono>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * THE KIT · N: each piece by its closet name, a linked one opening its
 * product in a new tab through the one outbound product link (which shows
 * the domain beside it), and what kind of piece it is. Absent with none.
 */
function Pieces({ pieces }: Readonly<{ pieces: readonly PublicPiece[] }>) {
  if (pieces.length === 0) return;
  return (
    <section data-part="kit" className="flex flex-col gap-2">
      <h2 className="m-0">
        <Mono step="xs" className="text-muted">
          The kit · {String(pieces.length)}
        </Mono>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {pieces.map((piece, index) => (
          <li
            // Two pieces can share a name; their place in the kit cannot.
            key={`${String(index)}:${piece.name}`}
            className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 text-body"
          >
            {piece.url === undefined ? (
              <span className="text-ink">{piece.name}</span>
            ) : (
              <ProductLink url={piece.url} label={piece.name} />
            )}
            <Mono step="xs" className="shrink-0 text-muted">
              {piece.kind}
            </Mono>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The pitch (round 41 #86c), for the signed out only: the default card's
 * line, what the app does, and the two ways in. Sign-up is by invite, so
 * the primary asks for one on the marketing site; a code goes to `/join`.
 */
function Invite() {
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
 * `/k/<id>` for anything that is not a public kit (round 41 #86f): the
 * same page whatever the reason, built from the URL and nothing else.
 * Signed in, the bar's slot reads "Look in the app", to the app's own page
 * of the kit, which runs its own check.
 */
export function NotPublicPage({
  entryId,
  askSignedIn,
}: Readonly<{ entryId: string; askSignedIn: AskSignedIn }>): JSX.Element {
  const { isSignedIn } = useSignedInAfterLoad(askSignedIn);
  return (
    <PublicFrame
      entryId={entryId}
      intoApp="Look in the app"
      isSignedIn={isSignedIn}
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
      <section
        data-part="not-public"
        className="flex flex-col items-start gap-3"
      >
        <p className="m-0 text-body">
          A kit shows here only while the runner who logged it keeps it
          public.
        </p>
        <a href={MARKETING_ORIGIN} className={FOOT_LINK_CLASS}>
          What is dialed.run?
        </a>
      </section>
    </PublicFrame>
  );
}
