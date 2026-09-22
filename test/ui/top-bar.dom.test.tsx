import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { TopBar } from "../../src/ui/TopBar";

/**
 * DS1, the one top bar.
 *
 * happy-dom applies no stylesheet and has no layout, so nothing here can
 * ask whether the bar is *visible* at 1040 — that is Playwright's, and the
 * feature specs assert it at both widths. What is checkable here is
 * everything the contract says the bar contains and how each part
 * announces itself, which is the half that a width test would not catch
 * anyway.
 */
async function renderAt(pathname: string, element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

const bar = () => document.querySelector("[data-slot='top-bar']");

describe("TopBar", () => {
  it("is an inverted block, which is what makes the focus ring flip", async () => {
    await renderAt("/feed", <TopBar />);

    // T2 rule 04, "ink bar on paper, paper bar on ink". The attribute is
    // the whole mechanism: `ui/a11y.css` draws the focus ring in
    // `var(--ink)` and `ui/tokens.css` redefines `--ink` inside this
    // selector, so "the ring inverts with the bar" is derived rather than
    // written a second time. The product's first user of the block.
    expect(bar()).toHaveAttribute("data-ground", "ink");
    expect(bar()).toHaveClass("bg-ground", "text-ink");
  });

  it("carries the four destinations in order, as links", async () => {
    await renderAt("/feed", <TopBar />);

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      screen
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toStrictEqual([
      // The wordmark first: it links to Feed and is "the one place the
      // logo appears in the product".
      ["[dialed.run]", "/feed"],
      ["Feed", "/feed"],
      ["Closet", "/closet"],
      ["Call", "/call"],
      ["You", "/feed/me"],
      ["", "/feed/search"],
    ]);
    // Four, not six: the wordmark and the search glyph are in the bar, not
    // in the nav.
    expect(nav.querySelectorAll("a")).toHaveLength(4);
  });

  it("underlines the tab that owns the path, and only that one", async () => {
    await renderAt("/closet", <TopBar />);

    // Round 15: "the active link carries its own 2px border-bottom and
    // does not travel". The resting border is transparent rather than
    // absent, so becoming current does not move the label 2px.
    const closet = screen.getByRole("link", { name: "Closet" });
    expect(closet).toHaveClass("border-b-2", "border-cold-text");
    for (const name of ["Feed", "Call", "You"]) {
      expect(screen.getByRole("link", { name })).toHaveClass(
        "border-b-2",
        "border-transparent",
      );
    }
  });

  it("underlines nothing on a path no tab owns", async () => {
    // `/runs/manual` belongs to no tab, and the honest answer is none —
    // the same rule the phone bar follows. A bar that kept pointing at
    // wherever you were last is a bar that lies.
    await renderAt("/runs/manual", <TopBar />);

    for (const name of ["Feed", "Closet", "Call", "You"]) {
      expect(screen.getByRole("link", { name })).toHaveClass(
        "border-transparent",
      );
    }
  });

  it("says the verb the wider seat has room for", async () => {
    await renderAt("/feed", <TopBar />);

    // Round 15's ruling, and the reason this is a second element rather
    // than the phone launcher with a CSS-swapped word: the accessible
    // name has to contain the visible text, so two words means two
    // controls. Same role as the phone's — "a launcher cannot be where
    // you are".
    const launcher = screen.getByRole("button", { name: "Log a run" });
    expect(launcher).toHaveAttribute("aria-haspopup", "dialog");
    expect(launcher).not.toHaveAttribute("aria-current");
    // T1: "text on an accent is always ink" — the fixed colour. Inside
    // this block `--ink` is chalk, so `text-ink` would put chalk on pink.
    expect(launcher).toHaveClass("bg-action", "text-accent-ink");
  });

  it("opens the flow from the pill, which is not a link", async () => {
    // It still navigates — the flow is three routes, and `rise` is what
    // makes that read as a layer (`src/lib/nav-types.ts`). `haspopup`
    // describes what the runner gets, not which element implements it, so
    // there is no anchor here to find.
    const router = await renderAt("/closet", <TopBar />);
    expect(screen.queryByRole("link", { name: "Log a run" })).toBeNull();

    act(() => {
      screen.getByRole("button", { name: "Log a run" }).click();
    });

    // The destination comes from the shared table's launcher seat, so the
    // two bars cannot drift to different flows. The handler does not await
    // the navigation, so this waits for the router rather than the click.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/runs/new");
    });
  });

  it("opens the search screen rather than holding a field", async () => {
    await renderAt("/feed", <TopBar />);

    // Round 15 withdrew DS1a's 240px field: "a field is an input surface
    // with states nobody drew". The glyph is decorative and the link
    // carries the name, so a reader hears the destination rather than
    // "graphic".
    const search = screen.getByRole("link", { name: "Search runners" });
    expect(search).toHaveAttribute("href", "/feed/search");
    expect(document.querySelector("[data-slot='top-bar'] svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // And no theme control until dark mode ships.
    expect(screen.queryByText("AUTO")).not.toBeInTheDocument();
  });

  it("gives the bell the seat the per-screen header used to hold", async () => {
    // Bend 4: the bell "leaves the per-screen header and sits in the bar".
    // It is the caller's node, for the reason `Layout` takes it as a prop
    // at all — `ui/` may not import from `modules/`.
    await renderAt(
      "/feed",
      <TopBar bell={<button type="button">Notifications</button>} />,
    );

    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
  });

  it("holds every tappable thing to a 44px target", async () => {
    // Rule 03, asked of this bar specifically because it is four links, a
    // wordmark, a glyph and a pill — the densest row in the product, and
    // the one where padding a target is most tempting to skip.
    await renderAt("/feed", <TopBar />);

    const barElement = bar();
    expect(barElement).not.toBeNull();
    const targets = barElement?.querySelectorAll("a, button") ?? [];
    // Wordmark, four tabs, the search glyph and the pill.
    expect(targets).toHaveLength(7);
    for (const element of targets) expect(element).toHaveClass("target");
  });
});
