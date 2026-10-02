import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useGoHome,
  useTermsPromptWiring,
} from "../../src/modules/account/use-go-home";

/**
 * The terms prompt's ways on (ACC-6): invalidate first, so the page a
 * runner lands on reads the fresh gate rather than the one that sent them
 * to the prompt, then home — or, for a stale Accept, stay and reload.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/account/terms"] }),
  });
  await router.load();
  const invalidate = vi.spyOn(router, "invalidate");
  return { router, invalidate, ...render(<RouterProvider router={router} />) };
}

function GoHome() {
  const goHome = useGoHome();
  return (
    <button type="button" onClick={() => void goHome()}>
      Go
    </button>
  );
}

/**
What the wired Log out let fall, for the test that fails it.
*/
const failures: string[] = [];

function Wired({ signOut }: Readonly<{ signOut: () => Promise<unknown> }>) {
  const wiring = useTermsPromptWiring(signOut);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // The prompt's control band shows a failed sign-out; here it is
          // only noted.
          void wiring.logOut().then(undefined, () => {
            failures.push("log out");
          });
        }}
      >
        Log out
      </button>
      <button type="button" onClick={() => void wiring.onAccepted()}>
        Accepted
      </button>
      <button type="button" onClick={() => void wiring.onStale()}>
        Stale
      </button>
    </>
  );
}

describe("useGoHome", () => {
  it("invalidates the router's data and navigates to /", async () => {
    const { router, invalidate } = await renderWithRouter(<GoHome />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("useTermsPromptWiring", () => {
  it("goes home once accepted", async () => {
    const signOut = vi.fn(() => Promise.resolve());
    const { router, invalidate } = await renderWithRouter(
      <Wired signOut={signOut} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Accepted" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(invalidate).toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out, then goes home", async () => {
    const signOut = vi.fn(() => Promise.resolve());
    const { router } = await renderWithRouter(<Wired signOut={signOut} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("goes nowhere when signing out fails", async () => {
    const signOut = vi.fn(() => Promise.reject(new Error("down")));
    const { router, invalidate } = await renderWithRouter(
      <Wired signOut={signOut} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(failures).toStrictEqual(["log out"]);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/account/terms");
  });

  it("reloads the page in place when the terms went stale", async () => {
    const signOut = vi.fn(() => Promise.resolve());
    const { router, invalidate } = await renderWithRouter(
      <Wired signOut={signOut} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Stale" }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(router.state.location.pathname).toBe("/account/terms");
    expect(signOut).not.toHaveBeenCalled();
  });
});
