import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BackToCloset } from "../../src/modules/closet/components/BackToCloset";

async function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <BackToCloset /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("BackToCloset", () => {
  it.each(["/closet/item-1", "/closet/new", "/closet/edit/item-1"])(
    "is a way back, not the current page, on %s",
    async (path) => {
      await renderAt(path);

      const back = await screen.findByRole("link", { name: "Closet" });
      expect(back).toHaveAttribute("href", "/closet");
      expect(back).not.toHaveAttribute("aria-current");
    },
  );
});
