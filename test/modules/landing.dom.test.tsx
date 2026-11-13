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
  it("asks for access in the hero and offers Log in in the bar, never the tab bar", async () => {
    await renderWithRouter(<Landing signedIn={false} />);

    const bar = document.querySelector("[data-slot='landing-bar']");
    const [logIn] = screen.getAllByRole("link", { name: "Log in" });
    expect(logIn?.closest("[data-slot='landing-bar']")).toBe(bar);
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    // Round 50 · 151a: Request access is the primary ask (D-173).
    const ask = screen.getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", "/account/request-access");
    expect(ask.closest("main")).not.toBeNull();
    // Ink, never pink: "--action belongs to the product's own verbs".
    expect(ask).toHaveClass("bg-ink", "text-ground");
    expect(ask).not.toHaveClass("bg-action");
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Every run has an outfit. Log it." }),
    ).toBeVisible();
  });

  it("follows the ask with Have an account? Log in, below 720 only", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const [inBar, inHero] = screen.getAllByRole("link", { name: "Log in" });
    expect(inBar?.closest("[data-slot='landing-bar']")).not.toBeNull();
    expect(inHero).toHaveAttribute("href", "/auth/login");
    expect(inHero?.closest("main")).not.toBeNull();
    // Round 51 · 154.3 (#528): from 720 the bar's Log in is enough, so the
    // whole line goes at the bar's breakpoint.
    const line = inHero?.parentElement;
    expect(line).toHaveTextContent(/^Have an account\? Log in$/u);
    expect(line).toHaveClass("wide:hidden");
  });

  it("keeps the hero's wordmark for the phone only, plain", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const hero = screen.getByRole("main");
    const mark = hero.querySelector(String.raw`.wide\:hidden`);
    // Drawn halves, then the one spoken name; no brackets either way.
    expect(mark).toHaveTextContent(/^dialed\.rundialed\.run$/u);
    expect(mark?.querySelector(".sr-only")).toHaveTextContent(/^dialed\.run$/u);
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
    expect(screen.queryByRole("link", { name: "Request access" })).toBeNull();
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

  it("is Settings' last row: who is signed in, on this phone, and the verb (R55·182.2)", async () => {
    await renderWithRouter(
      <SignOutButton username="maya_runs" signOut={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveAccessibleDescription(
      "Signed in as @maya_runs On this phone",
    );
    // One bold --cold-text verb at the row's end, and no chevron.
    expect(button).toHaveClass("font-bold", "text-cold-text");
    const row = button.parentElement;
    expect(row?.lastElementChild).toBe(button);
    expect(row).toHaveClass("justify-between", "border-b");
    expect(row?.querySelector("svg")).toBeNull();
    expect(screen.getByText("On this phone")).toHaveClass("text-muted");
    expect(screen.getByText("Signed in as @maya_runs")).toHaveClass(
      "font-semibold",
    );
    expect(screen.queryByText(/Every device/u)).toBeNull();
  });

  it("says only Signed in for an account with no handle yet", async () => {
    await renderWithRouter(<SignOutButton signOut={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toHaveAccessibleDescription("Signed in On this phone");
  });

  it("is Account's Every device row, whatever the handle", async () => {
    await renderWithRouter(
      <SignOutButton isEverywhere username="maya_runs" signOut={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toHaveAccessibleDescription(
      "Every device Signs out your phone and other browsers",
    );
    expect(screen.queryByText(/Signed in as/u)).toBeNull();
  });
});
