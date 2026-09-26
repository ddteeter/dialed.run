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

import { Landing } from "../../src/modules/auth/components/Landing";
import { SignOutButton } from "../../src/modules/auth/components/SignOutButton";

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/**
 * `/` (round 21, item 23): its own bar from 720 up, and the hero's ask.
 */
describe("Landing, signed out", () => {
  it("offers Log in in the bar and Create account in the hero, never the tab bar", async () => {
    await renderWithRouter(<Landing signedIn={false} />);

    const bar = document.querySelector("[data-slot='landing-bar']");
    const [logIn] = screen.getAllByRole("link", { name: "Log in" });
    expect(logIn?.closest("[data-slot='landing-bar']")).toBe(bar);
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    const create = screen.getByRole("link", { name: "Create account" });
    expect(create).toHaveAttribute("href", "/auth/signup");
    // Ink, never pink: "--action belongs to the product's own verbs".
    expect(create).toHaveClass("bg-ink", "text-ground");
    expect(create).not.toHaveClass("bg-action");
    expect(
      screen.getByRole("heading", { name: "Every run has an outfit. Log it." }),
    ).toBeVisible();
  });

  it("repeats Log in in the hero only where there is no bar", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const [inBar, inHero] = screen.getAllByRole("link", { name: "Log in" });
    expect(inBar?.closest("[data-slot='landing-bar']")).not.toBeNull();
    expect(inHero).toHaveClass("wide:hidden");
    expect(inHero).toHaveAttribute("href", "/auth/login");
  });

  it("keeps the hero's wordmark for the phone only, plain", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const hero = screen.getByRole("main");
    const mark = hero.querySelector(String.raw`.wide\:hidden`);
    expect(mark).toHaveTextContent(/^dialed\.run$/u);
  });
});

describe("Landing, signed in", () => {
  it("offers Your closet in ink, in the bar and on the phone", async () => {
    await renderWithRouter(<Landing signedIn />);
    const [inBar, inHero] = screen.getAllByRole("link", {
      name: "Your closet",
    });
    expect(inBar?.closest("[data-slot='landing-bar']")).not.toBeNull();
    expect(inHero).toHaveAttribute("href", "/closet");
    expect(inHero).toHaveClass("wide:hidden", "bg-ink");
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
  });
});

describe("SignOutButton", () => {
  it("signs out behind [ Signing out ], a live control while it waits", async () => {
    const user = userEvent.setup();
    const done = Promise.withResolvers<undefined>();
    const signOut = vi.fn().mockReturnValue(done.promise);
    await renderWithRouter(<SignOutButton signOut={signOut} />);

    const button = screen.getByRole("button", { name: "Sign out" });
    await user.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Signing out");
    expect(button).not.toHaveAttribute("disabled");
    done.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("says Still signed in when it fails, never silently", async () => {
    const user = userEvent.setup();
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    await renderWithRouter(<SignOutButton signOut={signOut} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const band = await screen.findByText("Still signed in");
    expect(band.closest("[data-part='failure-band']")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.queryByText("Still signed in")).toBeNull();
    });
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
