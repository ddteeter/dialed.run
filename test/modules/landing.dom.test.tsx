import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
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
 * `/` (Round 55 · 175, in 176's one signed-out frame).
 */
describe("Landing, signed out", () => {
  it("wears the one frame, Log in in its bar, and never the tab bar", async () => {
    await renderWithRouter(<Landing signedIn={false} />);

    const bar = document.querySelector("[data-slot='landing-bar']");
    const logIn = screen.getByRole("link", { name: "Log in" });
    expect(logIn.closest("[data-slot='landing-bar']")).toBe(bar);
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    // The bar holds Log in, so the hero never offers it again.
    expect(screen.queryByText(/Have an account\?/u)).toBeNull();
  });

  it("sits on the bar's edge: gutters outside, the page measure inside (#625 A-09)", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("flex-1", "px-5", "wide:px-6");
    expect(main.firstElementChild).toHaveClass("mx-auto", "max-w-page");
    const hero = main.querySelector("[data-part='hero']");
    expect(main.firstElementChild?.firstElementChild).toBe(hero);
    // 96 under the bar at the desk, in the 7 of a 7/5 split whose 5 is the
    // image slot (#523), drawn as nothing.
    expect(hero).toHaveClass(
      "pt-12",
      "desk:pt-24",
      "desk:grid",
      "desk:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
    );
    expect(hero?.children).toHaveLength(1);
  });

  it("breaks the headline by sentence: LOG IT. always starts its own line", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Every run has an outfit. Log it.",
    });
    // A space between the sentences, so a reader that ignores the
    // blocks still hears two.
    expect(heading.textContent).toBe("Every run has an outfit. Log it.");
    const [first, second] = heading.querySelectorAll("span");
    expect(first).toHaveTextContent(/^Every run has an outfit\.$/u);
    expect(first).toHaveClass("block", "text-balance");
    expect(second).toHaveTextContent(/^Log it\.$/u);
    expect(second).toHaveClass("block");
  });

  it("carries the pink Request access below 720 only, then Have a code? Create an account", async () => {
    await renderWithRouter(<Landing signedIn={false} />);
    const hero = within(screen.getByRole("main"));
    const ask = hero.getByRole("link", { name: "Request access" });
    expect(ask).toHaveAttribute("href", "/account/request-access");
    // From 720 the bar holds it, so it shows once per view.
    expect(ask).toHaveClass(
      "target",
      "rounded-pill",
      "bg-action",
      "text-accent-ink",
      "self-stretch",
      "wide:hidden",
    );
    const create = hero.getByRole("link", { name: "Create an account" });
    expect(create).toHaveAttribute("href", "/join");
    expect(create).toHaveClass("font-bold", "text-ink", "underline");
    expect(create.parentElement).toHaveTextContent(
      /^Have a code\? Create an account$/u,
    );
    expect(create.parentElement).toHaveClass("text-quiet");
    expect(screen.queryByRole("link", { name: "Your closet" })).toBeNull();
  });
});

describe("Landing, signed in", () => {
  it("wears the product's shell and ends on Go to your feed, never a second Log a run", async () => {
    await renderWithRouter(<Landing signedIn />);
    expect(document.querySelector("[data-slot='tab-bar']")).not.toBeNull();
    expect(document.querySelector("[data-slot='landing-bar']")).toBeNull();
    const main = within(screen.getByRole("main"));
    const go = main.getByRole("link", { name: "Go to your feed" });
    expect(go).toHaveAttribute("href", "/feed");
    expect(go).toHaveClass("target", "rounded-pill", "bg-ink", "text-ground");
    expect(go).not.toHaveClass("bg-action");
    expect(main.queryByRole("link", { name: "Request access" })).toBeNull();
    expect(main.queryByRole("link", { name: "Create an account" })).toBeNull();
    expect(main.queryByText("Log a run")).toBeNull();
    expect(go.closest("[data-part='hero']")?.parentElement).toHaveClass("px-6");
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
    // The row, then its band under it, a rhythm apart.
    expect(row?.parentElement).toHaveAttribute("data-part", "sign-out-row");
    expect(row?.parentElement).toHaveClass("flex", "flex-col", "gap-3");
    expect(row?.parentElement).not.toHaveClass("items-end");
    expect(screen.getByText("On this phone")).toHaveClass("text-muted");
    // Heard once, through the button's description, not again as text.
    expect(screen.getByText("On this phone").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
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

  it("is the Desk bar's mono, underlined Sign out at the bar's right, with no row (R55·194)", async () => {
    const user = userEvent.setup();
    const done = Promise.withResolvers<undefined>();
    const signOut = vi.fn().mockReturnValue(done.promise);
    await renderWithRouter(<SignOutButton isDeskBar signOut={signOut} />);
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveClass(
      "font-mono",
      "text-mono-xs",
      "uppercase",
      "underline",
      "underline-offset-4",
      "text-ink",
      "px-1",
    );
    expect(button).not.toHaveClass(
      "self-center",
      "p-0",
      "text-body",
      "font-semibold",
      "text-cold-text",
    );
    const root = button.closest("[data-part='desk-sign-out']");
    expect(root).toHaveClass("flex", "flex-col", "items-end");
    expect(root).not.toHaveClass("gap-3");
    expect(document.querySelector("[data-part='sign-out-row']")).toBeNull();
    expect(screen.queryByText(/Signed in|On this phone/u)).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");

    await user.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Signing out");
    done.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("says Still signed in from the Desk bar too", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockRejectedValueOnce(new Error("down"));
    await renderWithRouter(<SignOutButton isDeskBar signOut={signOut} />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const band = await screen.findByText("Still signed in");
    expect(band.closest("[data-part='desk-sign-out']")).not.toBeNull();
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
