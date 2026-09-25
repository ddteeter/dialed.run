import {
  Link,
  Navigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { z } from "zod";

import {
  FailureBand,
  Layout,
  Page,
  TABS,
  classifyFailure,
  tabToLight,
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
 * The frame: the product shell signed in, nothing at all signed out.
 *
 * `Page` on its own is the bare frame — it stamps hydration and sets the
 * panel, and wears no bar.
 */
function SystemFrame({
  signedIn,
  children,
}: Readonly<{ signedIn: boolean; children: ReactNode }>): JSX.Element {
  const body = <Page width="panel">{children}</Page>;
  return signedIn ? <Layout>{body}</Layout> : body;
}

/**
 * X1 · NOT FOUND.
 *
 * *"One sentence covers 'gone' and 'private' so a 404 never confirms a
 * hidden entry exists."* No brackets on the headline: *"brackets mean
 * waiting or a next step, and this is neither."* The way out is the feed
 * signed in, and Log in signed out.
 */
export function NotFoundState({
  signedIn,
}: Readonly<{ signedIn: boolean }>): JSX.Element {
  return (
    <SystemFrame signedIn={signedIn}>
      <section
        data-part="system-state"
        data-state="not-found"
        className="flex flex-col items-start gap-4"
      >
        <span aria-hidden="true" className="font-display text-display">
          404
        </span>
        <h1 className="m-0 font-display text-display uppercase">
          Nothing here
        </h1>
        <p className="m-0 text-body">
          This page doesn&apos;t exist, or it&apos;s an entry its runner has
          made private.
        </p>
        {signedIn ? (
          <Link to="/feed" className={WAY_OUT_CLASS}>
            Go to your feed
          </Link>
        ) : (
          <Link to="/auth/login" className={WAY_OUT_CLASS}>
            Log in
          </Link>
        )}
      </section>
    </SystemFrame>
  );
}

const WAY_OUT_CLASS =
  "target inline-flex items-center rounded-pill bg-ink px-5 font-bold text-ground no-underline";

/**
 * The router's not-found screen, framed by who is looking.
 */
export function NotFound(): JSX.Element {
  return <NotFoundState signedIn={useViewer().isSignedIn} />;
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
}: Readonly<{
  signedIn: boolean;
  message: string;
  onRetry: () => void;
}>): JSX.Element {
  return (
    <SystemFrame signedIn={signedIn}>
      <section data-part="system-state" data-state="loader-failed">
        <FailureBand kicker="Didn't load" message={message} onRetry={onRetry} />
      </section>
    </SystemFrame>
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
export function RouteFailed(props: Readonly<ErrorComponentProps>): JSX.Element {
  return classifyFailure(props.error).kind === "session" ? (
    <SignInAgain />
  ) : (
    <LoaderFailed error={props.error} />
  );
}

/**
The lapsed session's way on: log-in, returning here after.
*/
function SignInAgain(): JSX.Element {
  const router = useRouter();
  // The page that failed, read once. Subscribed, it would change the moment
  // this navigation began — to log-in itself — and this would redirect
  // again, back to log-in, carrying log-in, forever.
  const [from] = useState(() => router.state.location.href);
  return <Navigate to="/auth/login" search={{ redirect: from }} replace />;
}

function LoaderFailed({ error }: Readonly<{ error: unknown }>): JSX.Element {
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const lit = tabToLight(pathname, undefined);
  const label = TABS.find((_tab, index) => index === lit)?.label;

  return (
    <LoaderFailedState
      signedIn={useViewer().isSignedIn}
      message={loaderFailureMessage(error, label)}
      onRetry={() => {
        void router.invalidate();
      }}
    />
  );
}
