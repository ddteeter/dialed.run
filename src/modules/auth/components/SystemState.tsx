import {
  Link,
  Navigate,
  type LinkProps,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ComponentProps, JSX, ReactNode } from "react";
import { z } from "zod";

import { returnPathOf } from "../../../lib/return-path";
import {
  FailureBand,
  Layout,
  Mono,
  Page,
  PhoneBell,
  TABS,
  classifyFailure,
  tabToLight,
  useTermsRefusal,
} from "../../../ui";

/**
 * Round 22's system states (`X Not found`, `X Loader failed`), which
 * replace the framework's defaults.
 *
 * *"Signed in, the shell stays so the tab bar is the way out. Signed out,
 * Auth's rule: no bars."* So each state is one body and two frames, and
 * which frame is the only thing the session decides.
 */

/**
 * What the root route's loader hands down: whether anyone is signed in.
 *
 * Read from the router's own state rather than a prop, because the router
 * renders these components itself (`defaultNotFoundComponent`,
 * `defaultErrorComponent`) and passes them nothing of ours. Parsed, not
 * cast: a match's loader data is `unknown` at this distance, and a match
 * that has not loaded is simply "not signed in" — the frame with no bars,
 * which is the safe one to show a stranger.
 */
const rootMatchSchema = z.object({
  loaderData: z.object({ signedIn: z.boolean() }),
});

function useViewer(): { isSignedIn: boolean } {
  const [root] = useRouterState({ select: (state) => state.matches });
  const parsed = rootMatchSchema.safeParse(root);
  return { isSignedIn: parsed.success && parsed.data.loaderData.signedIn };
}

/**
 * Draws the bell once its counts arrive: the shell's bell for a page no
 * loader of ours ran for.
 *
 * The router renders these states itself and hands them nothing, so
 * there is no loader to read the counts in (PR #104). `router.tsx` wires
 * the server call in instead, and the states call it after mount (owner,
 * 2026-11-06): no other page pays for it, and the bell arrives just after
 * hydration. A component may not import a server function, so it is a
 * prop.
 */
export type LoadBell = () => Promise<ReactNode>;

/**
 * The bell, once `loadBell` has drawn it, and nothing until then.
 *
 * Nothing either when it fails: a page that is already saying something
 * failed does not say a second thing about the bell (law 5), and the bell
 * is back on the next page that loads. Signed out there is no shell, so
 * nothing is asked for.
 */
function useLoadedBell(
  isSignedIn: boolean,
  loadBell: LoadBell | undefined,
): ReactNode {
  const [bell, setBell] = useState<ReactNode>();
  useEffect(() => {
    if (!isSignedIn || loadBell === undefined) return;
    // No cancel on the way out: a bell that lands after the page has gone
    // sets state nothing renders, which React ignores.
    void loadBell()
      .then(setBell)
      .catch(() => {
        // Degrade: the shell without its bell.
      });
  }, [isSignedIn, loadBell]);
  return bell;
}

/**
 * The frame: the product shell signed in, a bare `<main>` signed out.
 *
 * `Page` on its own is the bare frame — it stamps hydration and sets the
 * panel, and wears no bar.
 */
function SystemFrame({
  signedIn,
  loadBell,
  width = "panel",
  children,
}: Readonly<{
  signedIn: boolean;
  loadBell: LoadBell | undefined;
  /**
  The column of the screen this replaces (R55·185); the panel when absent.
  */
  width?: PageWidth | undefined;
  children: ReactNode;
}>): JSX.Element {
  const bell = useLoadedBell(signedIn, loadBell);
  const body = <Page width={width}>{children}</Page>;
  // Signed in, `Layout`'s content is the page's main landmark; signed out
  // there is no shell, so the frame is its own (plan 161's `region`).
  return signedIn ? <Layout bell={bell}>{body}</Layout> : <main>{body}</main>;
}

/**
A page's width, as `Page` takes it.
*/
type PageWidth = NonNullable<ComponentProps<typeof Page>["width"]>;

/**
 * What a not-found names when its route knows what was missing (R55·185):
 * its own sentence, its own way out, and the column of the screen it
 * replaces — "That piece isn't in your closet. It may have been deleted."
 * and Go to your closet.
 */
export interface NotFoundSubject {
  readonly sentence: string;
  readonly to: NonNullable<LinkProps["to"]>;
  readonly label: string;
  readonly width: PageWidth;
}

/**
 * X1 · NOT FOUND.
 *
 * *"One sentence covers 'gone' and 'private' so a 404 never confirms a
 * hidden entry exists."* No brackets on the headline: *"brackets mean
 * waiting or a next step, and this is neither."* The way out is the feed
 * signed in, and Log in signed out — or, for a named `subject`, its own.
 */
export function NotFoundState({
  signedIn,
  loadBell,
  subject,
}: Readonly<{
  signedIn: boolean;
  loadBell?: LoadBell | undefined;
  /**
  The missing thing, named (R55·185). Absent, X1's one sentence for anything.
  */
  subject?: NotFoundSubject | undefined;
}>): JSX.Element {
  return (
    <SystemFrame
      signedIn={signedIn}
      loadBell={loadBell}
      width={subject?.width}
    >
      <section
        data-part="system-state"
        data-state="not-found"
        className="flex flex-col items-start gap-4"
      >
        {/* X1 draws "404" as a small muted kicker over the one headline
            (#632 A-04), as the public pages' own not-found does; at the
            display step it read as a second headline. */}
        {/* The kicker's row is the screen's first, so it ends in the
            phone's bell (Design 169.1). */}
        <div className="flex w-full items-center justify-between">
          <span aria-hidden="true">
            <Mono step="xs" className="text-muted">
              404
            </Mono>
          </span>
          <PhoneBell />
        </div>
        <h1 className="m-0 font-display text-display uppercase">
          Nothing here
        </h1>
        <p className="m-0 text-body">{subject?.sentence ?? NOT_FOUND_LINE}</p>
        <WayOut signedIn={signedIn} subject={subject} />
      </section>
    </SystemFrame>
  );
}

/**
X1's one sentence for anything that is not there.
*/
const NOT_FOUND_LINE =
  "This page doesn't exist, or it's an entry its runner has made private.";

/**
 * X1's one way out: the subject's own, else the feed signed in and Log in
 * signed out.
 */
function WayOut({
  signedIn,
  subject,
}: Readonly<{
  signedIn: boolean;
  subject: NotFoundSubject | undefined;
}>): JSX.Element {
  if (subject !== undefined) {
    return (
      <Link to={subject.to} className={WAY_OUT_CLASS}>
        {subject.label}
      </Link>
    );
  }
  return signedIn ? (
    <Link to="/feed" className={WAY_OUT_CLASS}>
      Go to your feed
    </Link>
  ) : (
    <Link to="/auth/login" className={WAY_OUT_CLASS}>
      Log in
    </Link>
  );
}

/**
 * X1's way out is the hairline pill (#632 A-04): leaving a 404 is not the
 * screen's own action, so it is neither pink nor the filled ink pill.
 */
const WAY_OUT_CLASS =
  "target inline-flex items-center rounded-pill border border-hairline px-5 font-semibold text-ink no-underline";

/**
 * The router's not-found screen, framed by who is looking.
 */
export function NotFound({
  loadBell,
}: Readonly<{ loadBell?: LoadBell | undefined }>): JSX.Element {
  return (
    <NotFoundState signedIn={useViewer().isSignedIn} loadBell={loadBell} />
  );
}

/**
 * What a read failure says, in the Form Contract's cause lines.
 *
 * *"Our end failed. Your closet is fine."* — the second sentence names the
 * screen's own thing, so it is said only where the screen has one: a tab
 * whose content is the runner's (Feed, Closet). Anywhere else the cause
 * stands alone rather than a sentence being invented for it. *"Never a
 * stack trace, never an error code in copy."*
 */
const STILL_FINE: ReadonlyMap<string | undefined, string> = new Map([
  ["Feed", "Your feed is fine."],
  ["Closet", "Your closet is fine."],
]);

export function loaderFailureMessage(
  error: unknown,
  tabLabel: string | undefined,
): string {
  if (classifyFailure(error).kind === "network") {
    return "Your connection dropped.";
  }
  const fine = STILL_FINE.get(tabLabel);
  return fine === undefined ? "Our end failed." : `Our end failed. ${fine}`;
}

/**
 * X2 · SOMETHING FAILED · LOADER.
 *
 * *"The Form Contract's band, reused for reads: same block, 'Didn't load'
 * in place of 'Nothing saved', top of the content area where the screen's
 * first part would be."* The tab stays lit, because the route did.
 */
export function LoaderFailedState({
  signedIn,
  message,
  onRetry,
  loadBell,
}: Readonly<{
  signedIn: boolean;
  message: string;
  onRetry: () => void;
  loadBell?: LoadBell | undefined;
}>): JSX.Element {
  return (
    <SystemFrame signedIn={signedIn} loadBell={loadBell}>
      <section data-part="system-state" data-state="loader-failed">
        {/* The page's one heading, as X1 has: the band's kicker, said
            first so a screen reader's heading list finds the page. Not
            drawn, because the band already shows the words. */}
        <h1 className="sr-only">{LOADER_FAILED_KICKER}</h1>
        {/* The band is the screen's first part and draws no row of its
            own, so the phone's bell takes one above it (Design 169.2:
            "every signed-in screen"). */}
        <div className="flex justify-end">
          <PhoneBell />
        </div>
        <FailureBand
          kicker={LOADER_FAILED_KICKER}
          message={message}
          onRetry={onRetry}
        />
      </section>
    </SystemFrame>
  );
}

const LOADER_FAILED_KICKER = "Didn't load";

/**
 * X2's root crash: *"A root crash (no shell possible) renders this band
 * alone on paper with 'Reload'."*
 *
 * The root itself failed, so there is no shell to keep and no loader
 * beneath it to re-run: Reload loads the document again. Paper, no bars,
 * whoever is looking — the root's own answer about who that is is what
 * failed.
 */
export function RootCrashedState({
  message,
  onReload,
}: Readonly<{ message: string; onReload: () => void }>): JSX.Element {
  return (
    <main>
      <Page width="panel">
        <section data-part="system-state" data-state="root-crashed">
          <h1 className="sr-only">{LOADER_FAILED_KICKER}</h1>
          <FailureBand
            kicker={LOADER_FAILED_KICKER}
            message={message}
            onRetry={onReload}
            retryLabel="Reload"
          />
        </section>
      </Page>
    </main>
  );
}

/**
 * The router's error screen: the band, framed by who is looking, and Try
 * again re-running the loaders that failed.
 *
 * **Except when the failure is the session.** A loader whose server
 * function found nobody signed in did not fail — the runner is signed out,
 * and "Our end failed" would be a lie about whose end. The Form Contract
 * routes a lapsed session to sign-in, so this does too, carrying the page
 * as log-in's way back.
 */
export function RouteFailed(
  props: Readonly<ErrorComponentProps & { loadBell?: LoadBell | undefined }>,
): JSX.Element {
  const { kind } = classifyFailure(props.error);
  if (kind === "session") return <SignInAgain />;
  if (kind === "terms") {
    return <TermsAgain error={props.error} loadBell={props.loadBell} />;
  }
  return <LoaderFailed error={props.error} loadBell={props.loadBell} />;
}

/**
 * A stale tab's loader refused because the runner is behind on the terms
 * (ACC-6; decision D-96): not a failure either, so it goes to the terms
 * prompt, by the root's answer (`ui/terms-refusal`) — the one place that
 * knows how, so the memo is forgotten here too. With no answer above it —
 * a test with no root — it is the band.
 */
function TermsAgain({
  error,
  loadBell,
}: Readonly<{
  error: unknown;
  loadBell: LoadBell | undefined;
}>): JSX.Element | undefined {
  const answer = useTermsRefusal();
  useEffect(() => {
    answer?.();
  });
  return answer === undefined ? (
    <LoaderFailed error={error} loadBell={loadBell} />
  ) : undefined;
}

/**
The lapsed session's way on: log-in, returning here after.
*/
function SignInAgain(): JSX.Element {
  const router = useRouter();
  // The page that failed, read once. Subscribed, it would change the moment
  // this navigation began — to log-in itself — and this would redirect
  // again, back to log-in, carrying log-in, forever.
  // `returnPathOf` keeps path and search, and drops a page log-in may not
  // return to, so the URL never carries a way back into the auth pages.
  const [from] = useState(() => returnPathOf(router.state.location));
  return <Navigate to="/auth/login" search={{ redirect: from }} replace />;
}

function LoaderFailed({
  error,
  loadBell,
}: Readonly<{
  error: unknown;
  loadBell: LoadBell | undefined;
}>): JSX.Element {
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // The first match is the root's. A root that failed before it ever
  // answered has drawn nothing and knows nobody, so there is no shell to
  // keep. A root that failed on a later navigation still holds its last
  // answer, and the shell stays with Try again, which re-runs it.
  const isRootCrash = useRouterState({
    // The root is the first match, so a crash is a never-answered error
    // found at index 0. A child's failure is found further along, or not.
    select: (state) =>
      state.matches.findIndex(
        (match) => match.status === "error" && match.loaderData === undefined,
      ) === 0,
  });
  if (isRootCrash) {
    return (
      <RootCrashedState
        message={loaderFailureMessage(error, undefined)}
        onReload={() => {
          globalThis.location.reload();
        }}
      />
    );
  }
  const lit = tabToLight(pathname, undefined);
  const label = TABS.find((_tab, index) => index === lit)?.label;

  return (
    <LoaderFailedState
      signedIn={useViewer().isSignedIn}
      message={loaderFailureMessage(error, label)}
      onRetry={() => {
        void router.invalidate();
      }}
      loadBell={loadBell}
    />
  );
}
