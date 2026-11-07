import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_KEY, applyTheme } from "../../src/lib/browser/theme";
import { ThemeSync } from "../../src/ui/ThemeSync";

/**
 * Design 185: the device's theme (`lib/browser/theme`) and the account's
 * over it (`ui/ThemeSync`). The head script is run in Chromium
 * (`test/lib/theme.browser.test.ts`), since happy-dom executes no script.
 */
const root = document.documentElement;

afterEach(() => {
  delete root.dataset.theme;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("applyTheme", () => {
  it.each(["light", "dark"] as const)(
    "pins %s on the root and keeps it on the device",
    (choice) => {
      applyTheme(choice);

      expect(root).toHaveAttribute("data-theme", choice);
      expect(localStorage.getItem(THEME_KEY)).toBe(choice);
    },
  );

  it("follows the system by taking the attribute off and forgetting the pin", () => {
    applyTheme("dark");

    applyTheme("system");

    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("writes to the root it is handed", () => {
    const block = document.createElement("div");

    applyTheme("light", block);

    expect(block).toHaveAttribute("data-theme", "light");
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("still changes the page when the device refuses to keep it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => {
      applyTheme("dark");
    }).not.toThrow();
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("keys the device's value where the head script reads it", () => {
    expect(THEME_KEY).toBe("dialed.run:theme");
  });
});

async function renderUnder(answer: () => unknown) {
  const rootRoute = createRootRoute({
    loader: answer,
    component: ThemeSync,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("ThemeSync", () => {
  it("puts the account's value over the device's when the root asked", async () => {
    localStorage.setItem(THEME_KEY, "light");
    root.dataset.theme = "light";

    await renderUnder(() => ({ signedIn: true, theme: "dark" }));

    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("goes back to the system when the root says nobody is signed in", async () => {
    localStorage.setItem(THEME_KEY, "dark");
    root.dataset.theme = "dark";

    await renderUnder(() => ({ signedIn: false, theme: "system" }));

    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("leaves the device alone on an open-web page, where the root did not ask", async () => {
    localStorage.setItem(THEME_KEY, "dark");
    root.dataset.theme = "dark";

    await renderUnder(() => ({ signedIn: false }));

    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("follows the root's answer when it changes under an open page", async () => {
    // A sign-in or sign-out invalidates the root, and its new answer has
    // to reach the page without a reload.
    let answer = { signedIn: true, theme: "dark" };
    const router = await renderUnder(() => answer);
    expect(root).toHaveAttribute("data-theme", "dark");

    answer = { signedIn: false, theme: "system" };
    await act(() => router.invalidate());

    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("ignores a theme it does not know", async () => {
    root.dataset.theme = "dark";

    await renderUnder(() => ({ signedIn: true, theme: "sepia" }));

    expect(root).toHaveAttribute("data-theme", "dark");
  });
});
