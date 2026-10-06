import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  AccountUnlessBehindOnTerms,
  AccountWhileBehind,
} from "../../src/modules/account/components/AccountWhileBehind";

/**
 * Settings › Account while the runner is behind on the terms (round 30
 * #4a; D-95): read only, with the hint and the way back to the prompt,
 * and the three things that stay live.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/account/sign-in"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function behindPage(hasPassword: boolean, username?: string) {
  return (
    <AccountWhileBehind
      account={{ email: "maya@example.com", hasPassword }}
      username={username}
      signOutEverywhere={<button type="button">Sign out everywhere</button>}
      dataExport={<button type="button">Get a copy</button>}
      deletion={<button type="button">Delete account</button>}
    />
  );
}

const HINT = "Accept the Terms to change this.";

describe("AccountWhileBehind (round 30 #4a)", () => {
  it("shows each setting as text with the hint, a way back to the prompt, and the live three", async () => {
    await renderWithRouter(behindPage(true, "maya_runs"));
    // The sub-page frame owns the heading; this is U1's body alone.
    expect(screen.queryByRole("heading")).toBeNull();

    const rows = [...document.querySelectorAll("[data-part='read-only-row']")];
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      `Emailmaya@example.com${HINT} Accept`,
      `Username@maya_runs${HINT} Accept`,
      `Password${HINT} Accept`,
    ]);
    // Values as text; Password has none to show.
    expect(
      rows.map((row) => row.querySelector("[data-part='value']")?.textContent),
    ).toStrictEqual(["maya@example.com", "@maya_runs", undefined]);
    for (const row of rows) {
      const hint = within(row as HTMLElement).getByText(HINT, {
        exact: false,
      });
      // TYPE.small in --muted, and no band: nothing failed.
      expect(hint).toHaveClass("text-small", "text-muted");
      expect(
        within(row as HTMLElement).getByRole("link", { name: "Accept" }),
      ).toHaveAttribute("href", "/account/terms");
    }
    // Values are text: nothing on the page can be typed into.
    expect(screen.queryByRole("textbox")).toBeNull();

    for (const name of [
      "Sign out everywhere",
      "Get a copy",
      "Delete account",
    ]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
  });

  it("has no Password row for an account with no password, and says when no handle is picked", async () => {
    await renderWithRouter(behindPage(false));
    const rows = [...document.querySelectorAll("[data-part='read-only-row']")];
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      `Emailmaya@example.com${HINT} Accept`,
      `UsernameNot picked${HINT} Accept`,
    ]);
  });
});

describe("AccountUnlessBehindOnTerms", () => {
  it("is the read-only page while behind, and the ordinary one otherwise", () => {
    const { rerender } = render(
      <AccountUnlessBehindOnTerms isBehind behind={<p>read only</p>}>
        <p>ordinary</p>
      </AccountUnlessBehindOnTerms>,
    );
    expect(screen.getByText("read only")).toBeVisible();
    expect(screen.queryByText("ordinary")).toBeNull();
    rerender(
      <AccountUnlessBehindOnTerms isBehind={false} behind={<p>read only</p>}>
        <p>ordinary</p>
      </AccountUnlessBehindOnTerms>,
    );
    expect(screen.getByText("ordinary")).toBeVisible();
    expect(screen.queryByText("read only")).toBeNull();
  });
});
