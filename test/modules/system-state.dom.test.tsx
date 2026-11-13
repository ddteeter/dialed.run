import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  LoaderFailedState,
  type LoadBell,
  NotFound,
  NotFoundState,
  RouteFailed,
  loaderFailureMessage,
} from "../../src/modules/auth/components/SystemState";
import {
  AuthRequiredError,
  TermsNotAcceptedError,
} from "../../src/modules/auth/auth-error";
import { TermsRefusalAnswer } from "../../src/ui";

/**
 * Round 22's system states: X1 not found, X2 loader failed. *"Signed in,
 * the shell stays so the tab bar is the way out. Signed out, Auth's rule:
 * no bars."*
 */
async function renderAt(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/somewhere"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const tabBar = () => document.querySelector("[data-slot='tab-bar']");
const state = () =>
  document.querySelector<HTMLElement>("[data-part='system-state']");

describe("X1 · not found", () => {
  it("keeps the shell signed in, lights no tab, and points at the feed", async () => {
    await renderAt(<NotFoundState signedIn />);

    expect(tabBar()).not.toBeNull();
    expect(document.querySelector("[data-slot='tab-indicator']")).toBeNull();
    expect(state()).toHaveAttribute("data-state", "not-found");
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing here" }),
    ).toBeVisible();
    // One sentence for gone and private, so a 404 never confirms a hidden
    // entry exists.
    expect(
      screen.getByText(
        "This page doesn't exist, or it's an entry its runner has made private.",
      ),
    ).toBeVisible();
    const wayOut = screen.getByRole("link", { name: "Go to your feed" });
    expect(wayOut).toHaveAttribute("href", "/feed");
    // The way out is X1's hairline pill (#632 A-04): pink is the
    // product's own verbs, and leaving a 404 is not one — nor is it the
    // screen's primary, so it is not the filled ink pill either.
    expect(wayOut).toHaveClass(
      "rounded-pill",
      "border",
      "border-hairline",
      "text-ink",
    );
    expect(wayOut).not.toHaveClass("bg-action");
    expect(wayOut).not.toHaveClass("bg-ink");
    // "404" is a small muted kicker, not a second headline.
    expect(screen.getByText("404")).toHaveClass("font-mono", "text-muted");
    expect(screen.getByText("404")).not.toHaveClass("text-display");
    // No brackets on the headline: this is neither a wait nor a next step.
    expect(state()).not.toHaveTextContent("[");
  });

  it("wears the one signed-out frame signed out, and the way out is the ink Log in (R55·174)", async () => {
    await renderAt(<NotFoundState signedIn={false} />);

    expect(tabBar()).toBeNull();
    expect(document.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(document.querySelector("[data-slot='landing-bar']")).not.toBeNull();
    expect(document.querySelector("[data-part='legal-footer']")).not.toBeNull();
    // X1's body in the 620 column, centred, 96 under the bar at width.
    const main = screen.getByRole("main");
    expect(main).toHaveClass(
      "flex-1",
      "px-5",
      "pt-12",
      "wide:px-6",
      "wide:pt-24",
    );
    expect(state()?.parentElement).toHaveClass("mx-auto", "max-w-column");
    expect(state()?.parentElement?.parentElement).toBe(main);
    const logIn = within(main).getByRole("link", { name: "Log in" });
    expect(logIn).toHaveAttribute("href", "/auth/login");
    expect(logIn).toHaveClass(
      "target",
      "rounded-pill",
      "bg-ink",
      "text-ground",
      "self-stretch",
      "wide:self-start",
    );
    expect(logIn).not.toHaveClass("border-hairline");
    // The phone's cross-link; at width the bar already offers it.
    const ask = within(main).getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", "/account/request-access");
    expect(ask).toHaveClass("font-bold", "text-ink", "underline");
    expect(ask.parentElement).toHaveTextContent(
      /^No account\? Request access$/u,
    );
    expect(ask.parentElement).toHaveClass("text-quiet", "wide:hidden");
    expect(screen.queryByRole("link", { name: "Go to your feed" })).toBeNull();
    expect(screen.getByText("404").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("sits in the panel when nothing is named", async () => {
    await renderAt(<NotFoundState signedIn />);
    expect(state()?.parentElement).toHaveClass("max-w-panel");
  });

  it("names a subject: its sentence, its way out, and its screen's column (R55·185)", async () => {
    await renderAt(
      <NotFoundState
        signedIn
        subject={{
          sentence:
            "That piece isn't in your closet. It may have been deleted.",
          to: "/closet",
          label: "Go to your closet",
          width: "column",
        }}
      />,
    );

    expect(
      screen.getByText(
        "That piece isn't in your closet. It may have been deleted.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/This page doesn't exist/)).toBeNull();
    const wayOut = screen.getByRole("link", { name: "Go to your closet" });
    expect(wayOut).toHaveAttribute("href", "/closet");
    expect(wayOut).toHaveClass("rounded-pill", "border-hairline", "text-ink");
    expect(screen.queryByRole("link", { name: "Go to your feed" })).toBeNull();
    expect(state()?.parentElement).toHaveClass("max-w-column");
    expect(state()?.parentElement).not.toHaveClass("max-w-panel");
  });

  it("keeps a subject's own way out signed out too", async () => {
    await renderAt(
      <NotFoundState
        signedIn={false}
        subject={{
          sentence: "That run isn't in your runs. It may have been deleted.",
          to: "/runs",
          label: "Go to your runs",
          width: "column",
        }}
      />,
    );
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Go to your runs" })).toHaveAttribute(
      "href",
      "/runs",
    );
    expect(main.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(main.queryByRole("link", { name: "Request access" })).toBeNull();
  });
});

describe("X2 · loader failed", () => {
  it("is the band, opening Didn't load, in the shell when signed in", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    await renderAt(
      <LoaderFailedState
        signedIn
        message="Our end failed. Your closet is fine."
        onRetry={onRetry}
      />,
    );

    expect(tabBar()).not.toBeNull();
    // The page's one heading, as X1 has, in the band's own words: first in
    // the state, and not drawn, since the band shows them.
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Didn't load",
    });
    expect(heading).toHaveClass("sr-only");
    expect(state()?.firstElementChild).toBe(heading);
    const band = state()?.querySelector("[data-part='failure-band']");
    expect(band).toHaveTextContent("Didn't load");
    expect(band).toHaveTextContent("Our end failed. Your closet is fine.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no bars signed out", async () => {
    await renderAt(
      <LoaderFailedState
        signedIn={false}
        message="Our end failed."
        onRetry={vi.fn()}
      />,
    );
    expect(tabBar()).toBeNull();
    expect(state()).toHaveAttribute("data-state", "loader-failed");
    expect(
      screen.getByRole("heading", { level: 1, name: "Didn't load" }),
    ).toBeInTheDocument();
  });
});

describe("loaderFailureMessage", () => {
  it("names the tab's own thing as still fine, where it has one", () => {
    expect(loaderFailureMessage(new Error("x"), "Closet")).toBe(
      "Our end failed. Your closet is fine.",
    );
    expect(loaderFailureMessage(new Error("x"), "Feed")).toBe(
      "Our end failed. Your feed is fine.",
    );
  });

  it("says only the cause anywhere else", () => {
    expect(loaderFailureMessage(new Error("x"), "Call")).toBe(
      "Our end failed.",
    );
    expect(loaderFailureMessage(new Error("x"), undefined)).toBe(
      "Our end failed.",
    );
  });

  it("says the connection dropped for a network failure, whatever the tab", () => {
    expect(loaderFailureMessage(new TypeError("fetch"), "Closet")).toBe(
      "Your connection dropped.",
    );
  });
});

/**
 * The two router-facing components, inside a router whose root loader
 * says who is signed in — the way `__root.tsx` hands it down.
 */
/**
 * A load that never settles: the navigation to the prompt stays pending,
 * so what the failed page shows meanwhile can be read.
 */
const NEVER = new Promise<never>(() => {
  // Never settles.
});

async function routedApp({
  signedIn,
  path,
  failWith,
  answersTerms = false,
  termsLoaderPending = false,
  loadBell,
  rootFails = { now: false },
}: Readonly<{
  signedIn: boolean | "unloaded";
  path: string;
  failWith?: Error;
  /**
  Whether the root mounts the terms refusal's answer, as `__root.tsx` does.
  */
  answersTerms?: boolean;
  /**
  Holds `/account/terms`'s loader pending forever, so a test can observe the
  failed page while the navigation to the prompt is still in flight — the
  prompt route never actually mounts.
  */
  termsLoaderPending?: boolean;
  /**
  The bell's read, as `router.tsx` wires `bellLoader(bellStateFn)` in.
  */
  loadBell?: LoadBell;
  /**
  Whether the root's own loader throws, read on each load: round 22's root
  crash, from the first load or only a later one.
  */
  rootFails?: { now: boolean };
}>) {
  const rootRoute = createRootRoute({
    // Like `__root.tsx`: a gate on every navigation, and an answer read
    // once and kept.
    beforeLoad: () => {
      if (rootFails.now) throw new Error("root down");
    },
    loader: () => (signedIn === "unloaded" ? undefined : { signedIn }),
    staleTime: Infinity,
    component: () =>
      answersTerms ? (
        <TermsRefusalAnswer>
          <Outlet />
        </TermsRefusalAnswer>
      ) : (
        <Outlet />
      ),
  });
  const terms = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account/terms",
    // Returning `undefined` when not pending behaves exactly as no loader.
    loader: () => (termsLoaderPending ? NEVER : undefined),
    component: () => <p>the terms prompt</p>,
  });
  const closet = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    // A page with a name, so a loader's refusal that named it would show.
    staticData: { savedPage: "Closet", title: "Closet" },
    loader: () => {
      if (failWith) throw failWith;
    },
    component: () => <p>the closet</p>,
  });
  const gone = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/gone",
    loader: () => {
      // The route's own "nothing here", as run detail throws it.
      notFound({ throw: true });
    },
    component: () => <p>unreachable</p>,
  });
  const login = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth/login",
    component: () => <p>the log-in page</p>,
  });
  // A titled screen whose loader fails once, then reads.
  let flakyLoads = 0;
  const flaky = createRoute({
    getParentRoute: () => rootRoute,
    path: "/flaky",
    staticData: { title: "Flaky" },
    loader: () => {
      flakyLoads += 1;
      if (flakyLoads === 1) throw new Error("once");
    },
    component: () => <p>flaky read</p>,
  });
  // A screen with no title of its own, whose loader fails too.
  const untitled = createRoute({
    getParentRoute: () => rootRoute,
    path: "/untitled",
    loader: () => {
      if (failWith) throw failWith;
    },
    component: () => <p>untitled</p>,
  });
  // A titled layout whose loader fails, over a titled child that does not:
  // X2 keeps the failed one's title.
  const shell = createRoute({
    getParentRoute: () => rootRoute,
    path: "/shell",
    staticData: { title: "Shell" },
    loader: () => {
      if (failWith) throw failWith;
    },
    component: () => <Outlet />,
  });
  const inner = createRoute({
    getParentRoute: () => shell,
    path: "/inner",
    staticData: { title: "Inner" },
    component: () => <p>inner</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      closet,
      gone,
      login,
      terms,
      untitled,
      flaky,
      shell.addChildren([inner]),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultNotFoundComponent: () => <NotFound loadBell={loadBell} />,
    defaultErrorComponent: (props) => (
      <RouteFailed {...props} loadBell={loadBell} />
    ),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

/**
A bell the test can find, standing in for `NotificationBell`.
*/
const BELL = "the bell";
const bellIs = () => screen.queryAllByText(BELL);

describe("X2 keeps the failed screen's first row (R55·186)", () => {
  it("draws its title, then the bell at the row's end, and the band under it", async () => {
    await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
      loadBell: () => Promise.resolve(BELL),
    });
    await screen.findByText("Our end failed. Your closet is fine.");
    const row = document.querySelector("[data-part='first-row']");
    const title = within(row as HTMLElement).getByText("Closet");
    expect(title).toHaveClass(
      "m-0",
      "mr-auto",
      "font-display",
      "text-display",
      "uppercase",
    );
    expect(row?.firstElementChild).toBe(title);
    expect(row).toHaveClass("flex", "items-center", "justify-end", "gap-3");
    await waitFor(() => {
      expect(row?.lastElementChild).toHaveTextContent(BELL);
    });
    expect(row?.nextElementSibling).toHaveAttribute(
      "data-part",
      "failure-band",
    );
    expect(state()).toHaveClass("flex", "flex-col", "gap-4");
  });

  it("lets the screen back in once Try again reads, with nothing left failed", async () => {
    const user = userEvent.setup();
    await routedApp({ signedIn: true, path: "/flaky" });
    expect(await screen.findByText("Flaky", { selector: "p" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("flaky read")).toBeVisible();
    expect(document.querySelector("[data-part='first-row']")).toBeNull();
  });

  it("keeps the bell's row alone for a screen with no title", async () => {
    await routedApp({
      signedIn: true,
      path: "/untitled",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed.");
    const row = document.querySelector("[data-part='first-row']");
    expect(row?.children).toHaveLength(0);
  });

  it("keeps the title of the screen being gone to, whichever loader on the way failed", async () => {
    await routedApp({
      signedIn: true,
      path: "/shell/inner",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed.");
    const row = document.querySelector("[data-part='first-row']");
    expect(row).toHaveTextContent(/^Inner$/u);
  });
});

describe("the router's defaults", () => {
  it("frame an unknown path by the root's signed-in answer", async () => {
    await routedApp({ signedIn: true, path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).not.toBeNull();
  });

  it("show a stranger no bars", async () => {
    await routedApp({ signedIn: false, path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).toBeNull();
  });

  it("treat a root that has not answered as signed out", async () => {
    await routedApp({ signedIn: "unloaded", path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).toBeNull();
  });

  it("catch a route's own not-found the same way", async () => {
    await routedApp({ signedIn: true, path: "/runs/gone" });
    expect(await screen.findByText("Nothing here")).toBeVisible();
    expect(screen.queryByText("unreachable")).toBeNull();
  });

  it("put a loader's failure in the band, naming the lit tab's thing, and retry it", async () => {
    const user = userEvent.setup();
    const router = await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed. Your closet is fine.");
    // The tab stays lit: the route did.
    expect(
      document.querySelector("[data-slot='tab-indicator']"),
    ).not.toBeNull();

    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  it("send a lapsed session to log in, carrying the page back, rather than blaming our end", async () => {
    const router = await routedApp({
      signedIn: true,
      path: "/closet?view=all",
      failWith: new AuthRequiredError(),
    });

    await screen.findByText("the log-in page");
    expect(router.state.location.pathname).toBe("/auth/login");
    expect(router.state.location.search).toEqual({
      redirect: "/closet?view=all",
    });
    expect(screen.queryByText(/Our end failed/u)).toBeNull();
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("carry the page's path and search back, never its hash", async () => {
    const router = await routedApp({
      signedIn: true,
      path: "/closet?view=all#top",
      failWith: new AuthRequiredError(),
    });

    await screen.findByText("the log-in page");
    expect(router.state.location.search).toEqual({
      redirect: "/closet?view=all",
    });
  });

  it("send a stale tab behind on the terms to the prompt, once, carrying the page back (D-96)", async () => {
    const router = await routedApp({
      signedIn: true,
      path: "/closet?view=all",
      failWith: new TermsNotAcceptedError(),
      answersTerms: true,
    });

    await screen.findByText("the terms prompt");
    expect(router.state.location.pathname).toBe("/account/terms");
    expect(router.state.location.search).toEqual({ from: "/closet?view=all" });
    // A loader lost nothing typed, so no page is named (D-102).
    expect(router.state.location.searchStr).not.toContain("save");
    expect(router.history).toHaveLength(2);
    expect(screen.queryByText(/Our end failed/u)).toBeNull();
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("show the band for that refusal where nothing above answers it", async () => {
    await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new TermsNotAcceptedError(),
    });
    expect(
      await screen.findByText("Our end failed. Your closet is fine."),
    ).toBeVisible();
  });

  it("keeps an ordinary read failure in the band even with the terms answer mounted", async () => {
    // Only a `kind === "terms"` refusal goes to the prompt. An unrelated
    // failure (D1 down) must still land in the band and stay on the page
    // that failed, whether or not a terms-refusal provider happens to be
    // mounted above it.
    const router = await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
      answersTerms: true,
    });
    expect(
      await screen.findByText("Our end failed. Your closet is fine."),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/closet");
  });

  it("holds the band back while the terms navigation is still in flight", async () => {
    // The prompt's own loader never resolves here, so the navigation it
    // starts never lands — exposing whatever the failed page renders while
    // it is still the thing on screen.
    const router = await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new TermsNotAcceptedError(),
      answersTerms: true,
      termsLoaderPending: true,
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account/terms");
    });
    // Still showing the failed page's output, not the prompt: the prompt's
    // loader is stuck, so its component never mounts.
    expect(screen.queryByText("the terms prompt")).toBeNull();
    expect(screen.queryByText(/Our end failed/u)).toBeNull();
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("say only the cause off a tab", async () => {
    const rootRoute = createRootRoute({
      loader: () => ({ signedIn: true }),
      component: () => <Outlet />,
    });
    const elsewhere = createRoute({
      getParentRoute: () => rootRoute,
      path: "/onboarding/name",
      loader: () => {
        throw new Error("down");
      },
      component: () => <p>unreachable</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([elsewhere]),
      history: createMemoryHistory({ initialEntries: ["/onboarding/name"] }),
      defaultErrorComponent: RouteFailed,
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Our end failed.")).toBeVisible();
  });
});

describe("the system states' bell (PR #104)", () => {
  it("rings the signed-in 404 once the counts arrive, asking once", async () => {
    const loadBell = vi.fn<LoadBell>(() =>
      Promise.resolve(<span>{BELL}</span>),
    );
    await routedApp({ signedIn: true, path: "/nowhere", loadBell });
    await screen.findByText("Nothing here");

    await waitFor(() => {
      expect(bellIs().length).toBeGreaterThan(0);
    });
    // In the shell's own seat: the bell row becomes the banner it is on
    // every other signed-in page, and the placeholder goes.
    expect(
      screen
        .getAllByRole("banner")
        .some((banner) => banner.textContent.includes(BELL)),
    ).toBe(true);
    expect(loadBell).toHaveBeenCalledOnce();
  });

  it("rings the loader-failed shell too", async () => {
    const loadBell = vi.fn<LoadBell>(() =>
      Promise.resolve(<span>{BELL}</span>),
    );
    await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
      loadBell,
    });
    await screen.findByText("Our end failed. Your closet is fine.");
    await waitFor(() => {
      expect(bellIs().length).toBeGreaterThan(0);
    });
  });

  it("keeps the shell without a bell when the counts fail, and says nothing of it", async () => {
    const failed = Promise.withResolvers<never>();
    const loadBell = vi.fn<LoadBell>(() => failed.promise);
    await routedApp({ signedIn: true, path: "/nowhere", loadBell });
    await screen.findByText("Nothing here");
    failed.reject(new Error("D1 down"));
    await waitFor(() => {
      expect(loadBell).toHaveBeenCalledOnce();
    });
    await Promise.resolve();

    expect(tabBar()).not.toBeNull();
    expect(bellIs()).toEqual([]);
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("asks once the page learns it is signed in, not only on its first render", async () => {
    // The frame is framed by who is looking, and that can change under a
    // mounted page (the root answering late). The bell follows it.
    const loadBell = vi.fn<LoadBell>(() =>
      Promise.resolve(<span>{BELL}</span>),
    );
    function SignsIn() {
      const [isSignedIn, setIsSignedIn] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setIsSignedIn(true);
            }}
          >
            sign in
          </button>
          <NotFoundState signedIn={isSignedIn} loadBell={loadBell} />
        </>
      );
    }
    await renderAt(<SignsIn />);
    expect(loadBell).not.toHaveBeenCalled();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => {
      expect(bellIs().length).toBeGreaterThan(0);
    });
    expect(loadBell).toHaveBeenCalledOnce();
  });

  it("does not ask for a stranger, who has no shell to put it in", async () => {
    const loadBell = vi.fn<LoadBell>(() =>
      Promise.resolve(<span>{BELL}</span>),
    );
    await routedApp({ signedIn: false, path: "/nowhere", loadBell });
    await screen.findByText("Nothing here");

    expect(loadBell).not.toHaveBeenCalled();
    expect(bellIs()).toEqual([]);
  });
});

describe("X2 · root crash", () => {
  it("is the band alone on paper, with Reload, when the root itself failed", async () => {
    const reload = vi
      .spyOn(globalThis.location, "reload")
      .mockImplementation(() => {
        // Not in a test: there is no document to load again.
      });
    const user = userEvent.setup();
    await routedApp({
      signedIn: true,
      path: "/closet",
      rootFails: { now: true },
    });

    await screen.findByText("Our end failed.");
    expect(state()).toHaveAttribute("data-state", "root-crashed");
    expect(
      screen.getByRole("heading", { level: 1, name: "Didn't load" }),
    ).toBeInTheDocument();
    // No shell is possible: the root that draws it is what failed.
    expect(tabBar()).toBeNull();
    expect(document.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the shell, with Try again, when the root fails only after it has answered", async () => {
    // A navigation whose every read fails: the root's gate fails, but its
    // answer is kept from before, so it knows who is looking and the shell
    // is still possible.
    const rootFails = { now: false };
    const router = await routedApp({
      signedIn: true,
      path: "/runs/gone",
      rootFails,
    });
    await screen.findByText("Nothing here");
    rootFails.now = true;
    await router.navigate({ to: "/closet" });

    await screen.findByText("Our end failed. Your closet is fine.");
    // It is the root's failure on show, not the closet's: the closet's
    // loader has nothing to throw here.
    expect(router.state.matches[0]?.status).toBe("error");
    expect(tabBar()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("is not a root crash when the root simply has nothing to answer and a child fails", async () => {
    // A root with no answer of its own (loaderData undefined) that did not
    // fail: the failure is the closet's, so it is the band with Try again.
    await routedApp({
      signedIn: "unloaded",
      path: "/closet",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed. Your closet is fine.");

    expect(state()).toHaveAttribute("data-state", "loader-failed");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("keeps a child's failure in the shell, with Try again", async () => {
    await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed. Your closet is fine.");

    expect(state()).toHaveAttribute("data-state", "loader-failed");
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});
