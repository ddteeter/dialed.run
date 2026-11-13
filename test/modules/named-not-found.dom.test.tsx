import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { NotFoundState } from "../../src/modules/auth/components/SystemState";
import { PIECE_NOT_FOUND } from "../../src/modules/closet/piece-not-found";
import { RUN_NOT_FOUND } from "../../src/modules/runs/run-not-found";

/**
 * Round 55 · 185: a piece's and a run's not-found name the thing, offer
 * its own way out, and keep the column of the page they replace. The
 * routes hand these to X1's state, tested in
 * test/modules/system-state.dom.test.tsx.
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

describe("the named not-founds (Round 55 · 185)", () => {
  it("says a piece isn't in the closet, and goes to the closet", async () => {
    expect(PIECE_NOT_FOUND).toStrictEqual({
      sentence: "That piece isn't in your closet. It may have been deleted.",
      to: "/closet",
      label: "Go to your closet",
      width: "column",
    });
    await renderAt(<NotFoundState signedIn subject={PIECE_NOT_FOUND} />);

    expect(screen.getByText(PIECE_NOT_FOUND.sentence)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to your closet" }),
    ).toHaveAttribute("href", "/closet");
  });

  it("says a run isn't in the runs, and goes to the runs", async () => {
    expect(RUN_NOT_FOUND).toStrictEqual({
      sentence: "That run isn't in your runs. It may have been deleted.",
      to: "/runs",
      label: "Go to your runs",
      width: "column",
    });
    await renderAt(<NotFoundState signedIn subject={RUN_NOT_FOUND} />);

    expect(screen.getByText(RUN_NOT_FOUND.sentence)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to your runs" }),
    ).toHaveAttribute("href", "/runs");
  });
});
